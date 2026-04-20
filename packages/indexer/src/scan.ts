import { createHash } from "node:crypto";
import { basename } from "node:path";
import { childLogger, type DetectedProject } from "@brain/shared";
import { getDb, schema } from "@brain/db";
import { and, eq } from "drizzle-orm";
import { scanGit } from "./scanners/git.js";
import { scanManifests } from "./scanners/manifest.js";
import { scanProjectContext, type ProjectContext } from "./scanners/project-context.js";

export interface ScanResult {
  projectId: string;
  name: string;
  rootPath: string;
  dependenciesCount: number;
  branchesCount: number;
  isDirty: boolean;
  currentBranch: string | null;
  gitRemote: string | null;
  status: ProjectStatus;
  todoCount: number;
  framework: string | null;
  deployTargets: string[];
  serviceTokens: string[];
}

type ProjectStatus = "prototype" | "active" | "shipped" | "stale" | "abandoned" | "unknown";

export async function scanProject(detected: DetectedProject): Promise<ScanResult> {
  const db = getDb();
  const log = childLogger({ project: detected.name, path: detected.rootPath });

  const [git, manifest, context] = await Promise.all([
    scanGit(detected.rootPath).catch((err) => {
      log.warn({ err }, "git scan failed");
      return null;
    }),
    Promise.resolve(scanManifests(detected.rootPath)),
    Promise.resolve(scanProjectContext(detected.rootPath)),
  ]);

  const lastCommitAt = git?.recentCommits.find((c) => c.committedAt)?.committedAt ?? null;
  const lastActivityAt = lastCommitAt;
  const status = deriveStatus({
    lastCommitAt,
    commitCount: git?.recentCommits.length ?? 0,
    hasDeployTargets: context.deployTargets.length > 0,
    hasReadme: context.readmeFirstPara != null,
  });

  const projectValues = {
    rootPath: detected.rootPath,
    name: detected.name || basename(detected.rootPath),
    kind: detected.kind,
    gitRemote: git?.remote ?? null,
    primaryLang: manifest.primaryLang,
    lastScannedAt: new Date(),
    summary: context.summary,
    status,
    readmeFirstPara: context.readmeFirstPara,
    framework: context.framework,
    todoCount: context.todoCount,
    serviceTokens: context.serviceTokens,
    deployTargets: context.deployTargets,
    lastCommitAt,
    lastActivityAt,
  };

  const [project] = await db
    .insert(schema.projects)
    .values(projectValues)
    .onConflictDoUpdate({
      target: schema.projects.rootPath,
      set: projectValues,
    })
    .returning({ id: schema.projects.id });

  if (!project) throw new Error("failed to upsert project");
  const projectId = project.id;

  // Replace deps
  await db.delete(schema.dependencies).where(eq(schema.dependencies.projectId, projectId));
  if (manifest.dependencies.length > 0) {
    await db.insert(schema.dependencies).values(
      manifest.dependencies.map((d) => ({
        projectId,
        source: d.source,
        name: d.name,
        version: d.version,
        isDev: d.isDev,
      })),
    );
  }

  // Replace branches
  await db.delete(schema.gitBranches).where(eq(schema.gitBranches.projectId, projectId));
  if (git?.branches.length) {
    await db.insert(schema.gitBranches).values(
      git.branches.map((b) => ({
        projectId,
        name: b.name,
        headSha: b.headSha,
        isCurrent: b.isCurrent,
        isDirty: b.isCurrent ? git.isDirty : false,
        upstream: b.upstream,
        ahead: b.ahead,
        behind: b.behind,
      })),
    );
  }

  // Upsert commits
  if (git?.recentCommits.length) {
    await db
      .insert(schema.gitCommits)
      .values(
        git.recentCommits.map((c) => ({
          sha: c.sha,
          projectId,
          author: c.author,
          message: c.message,
          committedAt: c.committedAt,
          parentShas: c.parentShas,
        })),
      )
      .onConflictDoNothing({ target: schema.gitCommits.sha });
  }

  // Refresh TODO-derived open loops
  await db
    .delete(schema.openLoops)
    .where(and(eq(schema.openLoops.projectId, projectId), eq(schema.openLoops.source, "todo_comment")));
  if (context.todos.length > 0) {
    await db
      .insert(schema.openLoops)
      .values(
        context.todos.slice(0, 100).map((t) => ({
          projectId,
          source: "todo_comment" as const,
          text: t.text,
          sourceRef: `${t.file}:${t.line}`,
          mentionedAt: new Date(),
          dedupeKey: createHash("sha1")
            .update(`${projectId}|${t.file}:${t.line}|${t.text.slice(0, 80)}`)
            .digest("hex")
            .slice(0, 20),
        })),
      )
      .onConflictDoNothing({ target: schema.openLoops.dedupeKey });
  }

  await db.insert(schema.scanRuns).values({
    projectId,
    scanner: "phase1.5:git+manifest+context",
    status: "ok",
    finishedAt: new Date(),
  });

  return {
    projectId,
    name: detected.name,
    rootPath: detected.rootPath,
    dependenciesCount: manifest.dependencies.length,
    branchesCount: git?.branches.length ?? 0,
    isDirty: git?.isDirty ?? false,
    currentBranch: git?.currentBranch ?? null,
    gitRemote: git?.remote ?? null,
    status,
    todoCount: context.todoCount,
    framework: context.framework,
    deployTargets: context.deployTargets,
    serviceTokens: context.serviceTokens,
  };
}

export async function scanMany(projects: DetectedProject[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const p of projects) {
    try {
      results.push(await scanProject(p));
    } catch (err) {
      const db = getDb();
      await db.insert(schema.scanRuns).values({
        scanner: "phase1.5:git+manifest+context",
        status: "error",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      });
      childLogger({ project: p.name }).error({ err }, "scan failed");
    }
  }
  return results;
}

function deriveStatus(opts: {
  lastCommitAt: Date | null;
  commitCount: number;
  hasDeployTargets: boolean;
  hasReadme: boolean;
}): ProjectStatus {
  const { lastCommitAt, commitCount, hasDeployTargets, hasReadme } = opts;
  if (!lastCommitAt || commitCount === 0) return "unknown";
  const days = (Date.now() - lastCommitAt.getTime()) / 86_400_000;
  if (days > 365) return "abandoned";
  if (hasDeployTargets && days < 365) return days < 14 ? "active" : "shipped";
  if (days < 14) return "active";
  if (days < 90) {
    if (commitCount < 8 && !hasReadme) return "prototype";
    return "stale";
  }
  return "stale";
}

