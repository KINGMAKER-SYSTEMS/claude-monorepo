import type { Command } from "commander";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { formatRelativeTime } from "../format.js";

const SEVERITY_ICON: Record<string, string> = {
  urgent: "!!",
  warn: "! ",
  info: "· ",
};

const STATUS_COLOR: Record<string, (s: string) => string> = {
  active: pc.green,
  shipped: pc.cyan,
  prototype: pc.yellow,
  stale: pc.dim,
  abandoned: pc.dim,
  unknown: pc.dim,
};

export function registerStandup(program: Command): void {
  program
    .command("standup")
    .description("morning briefing: what needs you, what's in flight, what's running")
    .option("--json", "emit JSON instead of rendered text")
    .option("--days <n>", "look back window for in-flight projects (default 7)", "7")
    .action(async (opts: { json?: boolean; days?: string }) => {
      const db = getDb();
      const days = Number.parseInt(opts.days ?? "7", 10) || 7;
      const cutoff = new Date(Date.now() - days * 86_400_000);

      const [alertsRows, inFlight, stale, abandoned, openLoops, recentSessions, runningInfra] = await Promise.all([
        db
          .select({
            id: schema.alerts.id,
            severity: schema.alerts.severity,
            title: schema.alerts.title,
            detail: schema.alerts.detail,
            actionHint: schema.alerts.actionHint,
            detectedAt: schema.alerts.detectedAt,
            projectName: schema.projects.name,
          })
          .from(schema.alerts)
          .leftJoin(schema.projects, eq(schema.alerts.projectId, schema.projects.id))
          .where(eq(schema.alerts.status, "open"))
          .orderBy(
            sql`CASE ${schema.alerts.severity}
                  WHEN 'urgent' THEN 0
                  WHEN 'warn' THEN 1
                  WHEN 'info' THEN 2
                  ELSE 3 END`,
            desc(schema.alerts.detectedAt),
          ),

        db
          .select({
            id: schema.projects.id,
            name: schema.projects.name,
            status: schema.projects.status,
            summary: schema.projects.summary,
            framework: schema.projects.framework,
            deployTargets: schema.projects.deployTargets,
            serviceTokens: schema.projects.serviceTokens,
            lastCommitAt: schema.projects.lastCommitAt,
            lastActivityAt: schema.projects.lastActivityAt,
            todoCount: schema.projects.todoCount,
          })
          .from(schema.projects)
          .where(
            or(
              gte(schema.projects.lastActivityAt, cutoff),
              gte(schema.projects.lastCommitAt, cutoff),
            ),
          )
          .orderBy(desc(schema.projects.lastActivityAt)),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.projects)
          .where(eq(schema.projects.status, "stale")),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.projects)
          .where(eq(schema.projects.status, "abandoned")),

        db
          .select({
            id: schema.openLoops.id,
            text: schema.openLoops.text,
            source: schema.openLoops.source,
            mentionedAt: schema.openLoops.mentionedAt,
            projectName: schema.projects.name,
            sourceRef: schema.openLoops.sourceRef,
          })
          .from(schema.openLoops)
          .leftJoin(schema.projects, eq(schema.openLoops.projectId, schema.projects.id))
          .where(eq(schema.openLoops.status, "open"))
          .orderBy(desc(schema.openLoops.mentionedAt))
          .limit(10),

        db
          .select({
            id: schema.ccSessions.id,
            device: schema.ccSessions.device,
            cwd: schema.ccSessions.cwd,
            startedAt: schema.ccSessions.startedAt,
            endedAt: schema.ccSessions.endedAt,
            messageCount: schema.ccSessions.messageCount,
            lastUserMessage: schema.ccSessions.lastUserMessage,
            summary: schema.ccSessions.summary,
            projectName: schema.projects.name,
          })
          .from(schema.ccSessions)
          .leftJoin(schema.projects, eq(schema.ccSessions.projectId, schema.projects.id))
          .where(and(isNotNull(schema.ccSessions.endedAt), gte(schema.ccSessions.endedAt, cutoff)))
          .orderBy(desc(schema.ccSessions.endedAt))
          .limit(10),

        db
          .select({
            id: schema.infraResources.id,
            kind: schema.infraResources.kind,
            name: schema.infraResources.name,
            status: schema.infraResources.status,
            endpoint: schema.infraResources.endpoint,
            metadata: schema.infraResources.metadata,
            lastSeenAt: schema.infraResources.lastSeenAt,
            projectName: schema.projects.name,
          })
          .from(schema.infraResources)
          .leftJoin(schema.projects, eq(schema.infraResources.projectId, schema.projects.id))
          .where(eq(schema.infraResources.status, "running"))
          .orderBy(desc(schema.infraResources.lastSeenAt))
          .limit(30),
      ]);

      const inFlightIds: string[] = inFlight.map((p: InFlightRow) => p.id);
      const branchByProject =
        inFlightIds.length > 0
          ? await db
              .select({
                projectId: schema.gitBranches.projectId,
                name: schema.gitBranches.name,
                isDirty: schema.gitBranches.isDirty,
                ahead: schema.gitBranches.ahead,
              })
              .from(schema.gitBranches)
              .where(
                and(
                  eq(schema.gitBranches.isCurrent, true),
                  inArray(schema.gitBranches.projectId, inFlightIds),
                ),
              )
          : [];

      const branchMap = new Map<string, { name: string; isDirty: boolean; ahead: number | null }>();
      for (const b of branchByProject) {
        branchMap.set(b.projectId, { name: b.name, isDirty: b.isDirty, ahead: b.ahead });
      }

      const recentCommitByProject =
        inFlightIds.length > 0
          ? await db
              .select({
                projectId: schema.gitCommits.projectId,
                message: schema.gitCommits.message,
                committedAt: schema.gitCommits.committedAt,
                rn: sql<number>`row_number() over (partition by ${schema.gitCommits.projectId} order by ${schema.gitCommits.committedAt} desc nulls last)`,
              })
              .from(schema.gitCommits)
              .where(inArray(schema.gitCommits.projectId, inFlightIds))
          : [];
      const commitMap = new Map<string, { message: string | null; committedAt: Date | null }>();
      for (const row of recentCommitByProject) {
        if (row.rn === 1) commitMap.set(row.projectId, { message: row.message, committedAt: row.committedAt });
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              alerts: alertsRows,
              inFlight,
              openLoops,
              recentSessions,
              runningInfra,
              staleCount: stale[0]?.count ?? 0,
              abandonedCount: abandoned[0]?.count ?? 0,
            },
            null,
            2,
          ),
        );
        return;
      }

      renderStandup({
        alerts: alertsRows,
        inFlight,
        branchMap,
        commitMap,
        openLoops,
        recentSessions,
        runningInfra,
        staleCount: stale[0]?.count ?? 0,
        abandonedCount: abandoned[0]?.count ?? 0,
        days,
      });
    });
}

type AlertRow = {
  severity: string | null;
  title: string;
  detail: string | null;
  actionHint: string | null;
  detectedAt: Date | null;
  projectName: string | null;
};

type InFlightRow = {
  id: string;
  name: string;
  status: string;
  summary: string | null;
  framework: string | null;
  deployTargets: string[];
  serviceTokens: string[];
  lastCommitAt: Date | null;
  lastActivityAt: Date | null;
  todoCount: number;
};

type OpenLoopRow = {
  text: string;
  source: string;
  mentionedAt: Date | null;
  projectName: string | null;
  sourceRef: string | null;
};

type SessionRow = {
  device: string;
  cwd: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  messageCount: number;
  lastUserMessage: string | null;
  projectName: string | null;
};

type InfraRow = {
  kind: string;
  name: string;
  status: string | null;
  endpoint: string | null;
  metadata: unknown;
  lastSeenAt: Date | null;
  projectName: string | null;
};

function renderStandup(args: {
  alerts: AlertRow[];
  inFlight: InFlightRow[];
  branchMap: Map<string, { name: string; isDirty: boolean; ahead: number | null }>;
  commitMap: Map<string, { message: string | null; committedAt: Date | null }>;
  openLoops: OpenLoopRow[];
  recentSessions: SessionRow[];
  runningInfra: InfraRow[];
  staleCount: number;
  abandonedCount: number;
  days: number;
}): void {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const bar = pc.dim("━".repeat(60));

  console.log(bar);
  console.log(pc.bold(pc.cyan(`GOOD MORNING — ${dateStr}`)));
  console.log(bar);
  console.log("");

  // NEEDS YOU TODAY
  section("NEEDS YOU TODAY");
  if (args.alerts.length === 0) {
    console.log("  " + pc.dim("(nothing open — good to go)"));
  } else {
    for (const a of args.alerts.slice(0, 12)) {
      const icon = SEVERITY_ICON[a.severity ?? "warn"] ?? "  ";
      const color = a.severity === "urgent" ? pc.red : a.severity === "warn" ? pc.yellow : pc.dim;
      console.log(`  ${color(icon)} ${pc.bold(a.title)}`);
      if (a.detail) console.log(`      ${pc.dim(a.detail)}`);
      if (a.actionHint) console.log(`      ${pc.dim("→ " + a.actionHint)}`);
    }
    if (args.alerts.length > 12) console.log(pc.dim(`  …and ${args.alerts.length - 12} more`));
  }
  console.log("");

  // IN FLIGHT
  section(`IN FLIGHT (last ${args.days}d)`);
  if (args.inFlight.length === 0) {
    console.log("  " + pc.dim("(no active projects in window)"));
  } else {
    for (const p of args.inFlight.slice(0, 12)) {
      const statusColor = STATUS_COLOR[p.status] ?? pc.dim;
      const branch = args.branchMap.get(p.id);
      const commit = args.commitMap.get(p.id);
      const metaBits: string[] = [];
      if (p.framework) metaBits.push(p.framework);
      if (p.deployTargets.length) metaBits.push("→ " + p.deployTargets.join(","));
      if (p.serviceTokens.length) metaBits.push("uses " + p.serviceTokens.slice(0, 4).join(","));

      const dirtyTag = branch?.isDirty ? pc.yellow(" dirty") : "";
      const aheadTag = branch && branch.ahead && branch.ahead > 0 ? pc.yellow(` ↑${branch.ahead}`) : "";

      console.log(
        `  ${pc.bold(p.name)}  ${statusColor(p.status)}${dirtyTag}${aheadTag}  ${pc.dim(formatRelativeTime(p.lastActivityAt))}`,
      );
      if (p.summary) console.log(`      ${p.summary.slice(0, 120)}`);
      if (commit?.message) {
        const msg = commit.message.split("\n")[0] ?? "";
        console.log(`      ${pc.dim("last: ")}${msg.slice(0, 80)} ${pc.dim(formatRelativeTime(commit.committedAt))}`);
      }
      if (metaBits.length) console.log(`      ${pc.dim(metaBits.join(" · "))}`);
      if (p.todoCount > 0) console.log(`      ${pc.dim(`${p.todoCount} TODO${p.todoCount === 1 ? "" : "s"}`)}`);
    }
  }
  console.log("");

  // RECENT CLAUDE SESSIONS
  section("RECENT CLAUDE SESSIONS");
  if (args.recentSessions.length === 0) {
    console.log("  " + pc.dim("(no sessions ingested — run `brain transcripts sync`)"));
  } else {
    for (const s of args.recentSessions.slice(0, 6)) {
      const dur =
        s.startedAt && s.endedAt
          ? humanDuration(s.endedAt.getTime() - s.startedAt.getTime())
          : pc.dim("?");
      const where = s.projectName ?? (s.cwd ? pc.dim(s.cwd) : pc.dim("(unmatched)"));
      console.log(
        `  ${pc.dim(s.device.padEnd(12).slice(0, 12))} ${pc.bold(where)}  ${pc.dim(dur)}  ${pc.dim(formatRelativeTime(s.endedAt))}`,
      );
      if (s.lastUserMessage) {
        const line = s.lastUserMessage.split(/\r?\n/)[0] ?? "";
        console.log(`      ${pc.dim("› " + line.slice(0, 100))}`);
      }
    }
  }
  console.log("");

  // OPEN LOOPS
  section("OPEN LOOPS");
  if (args.openLoops.length === 0) {
    console.log("  " + pc.dim("(nothing pending)"));
  } else {
    for (const l of args.openLoops.slice(0, 8)) {
      const scope = l.projectName ? pc.cyan(l.projectName) : pc.dim("—");
      const srcIcon = l.source === "transcript" ? "§" : l.source === "todo_comment" ? "⌕" : "·";
      console.log(`  ${pc.dim(srcIcon)} ${scope}  ${l.text.slice(0, 110)}`);
      console.log(`      ${pc.dim(formatRelativeTime(l.mentionedAt))}${l.sourceRef ? pc.dim("  " + l.sourceRef) : ""}`);
    }
  }
  console.log("");

  // RUNNING NOW
  section("RUNNING NOW");
  if (args.runningInfra.length === 0) {
    console.log("  " + pc.dim("(nothing detected — docker + dev servers will appear here)"));
  } else {
    const containers = args.runningInfra.filter((r) => r.kind === "container");
    const devServers = args.runningInfra.filter((r) => r.kind === "dev_server");
    if (containers.length) {
      console.log(pc.dim("  containers"));
      for (const c of containers.slice(0, 10)) {
        const meta = c.metadata as { image?: string; composeService?: string | null } | null;
        const image = meta?.image ? pc.dim(meta.image) : "";
        const scope = c.projectName ? pc.cyan(c.projectName) : pc.dim("—");
        const svc = meta?.composeService ? pc.dim(`[${meta.composeService}]`) : "";
        console.log(`    ${pc.bold(c.name)} ${svc}  ${scope}  ${image}`);
        if (c.endpoint) console.log(`      ${pc.dim(c.endpoint)}`);
      }
      if (containers.length > 10) console.log(pc.dim(`    …and ${containers.length - 10} more`));
    }
    if (devServers.length) {
      console.log(pc.dim("  dev servers"));
      for (const d of devServers.slice(0, 10)) {
        const meta = d.metadata as { framework?: string | null; pid?: number; command?: string } | null;
        const scope = d.projectName ? pc.cyan(d.projectName) : pc.dim("—");
        const fw = meta?.framework ? pc.yellow(meta.framework) : pc.dim(meta?.command ?? "?");
        const pid = meta?.pid ? pc.dim(`pid ${meta.pid}`) : "";
        console.log(`    ${pc.bold(d.endpoint ?? d.name)}  ${scope}  ${fw}  ${pid}`);
      }
      if (devServers.length > 10) console.log(pc.dim(`    …and ${devServers.length - 10} more`));
    }
  }
  console.log("");

  // SUMMARY LINE
  section("BACKLOG");
  console.log(
    `  ${pc.dim(`${args.staleCount} stale · ${args.abandonedCount} abandoned — `)}${pc.dim("`brain projects --status stale`")}`,
  );
  console.log("");
}

function section(title: string): void {
  console.log(pc.bold(pc.white(title)));
}

function humanDuration(ms: number): string {
  if (ms < 0) return "?";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

