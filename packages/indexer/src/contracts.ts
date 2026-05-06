// -----------------------------------------------------------------------------
// Brain API contracts.
//
// This file is the menu: every function the brain exposes (over MCP, the CLI,
// or any future caller) declares its input and output shape here as a Zod
// schema. The TypeScript types are derived via z.infer so there's exactly one
// source of truth — if you change the schema, the type changes, and any caller
// that drifted will fail to compile.
//
// The MCP server imports these schemas directly (see packages/mcp/src/server.ts)
// and feeds them into McpServer.registerTool's inputSchema/outputSchema, which
// gives Claude Desktop / any MCP client a machine-readable contract for every
// brain tool. No more drift between SQL and the surface.
// -----------------------------------------------------------------------------

import { z } from "zod";

// ---------- shared row schemas ----------

export const AlertRowSchema = z.object({
  id: z.string().uuid(),
  severity: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  actionHint: z.string().nullable(),
  detectedAt: z.date().nullable(),
  projectName: z.string().nullable(),
});
export type AlertRow = z.infer<typeof AlertRowSchema>;

export const ListAlertRowSchema = AlertRowSchema.extend({
  kind: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
});
export type ListAlertRow = z.infer<typeof ListAlertRowSchema>;

export const InFlightProjectRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
  framework: z.string().nullable(),
  deployTargets: z.array(z.string()),
  serviceTokens: z.array(z.string()),
  lastCommitAt: z.date().nullable(),
  lastActivityAt: z.date().nullable(),
  todoCount: z.number().int(),
  currentBranch: z.string().nullable().optional(),
  isDirty: z.boolean().optional(),
  aheadCommits: z.number().int().nullable().optional(),
  lastCommitMessage: z.string().nullable().optional(),
});
export type InFlightProjectRow = z.infer<typeof InFlightProjectRowSchema>;

export const OpenLoopRowSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  refinedText: z.string().nullable(),
  source: z.string(),
  mentionedAt: z.date().nullable(),
  projectName: z.string().nullable(),
  sourceRef: z.string().nullable(),
});
export type OpenLoopRow = z.infer<typeof OpenLoopRowSchema>;

export const ListOpenLoopRowSchema = OpenLoopRowSchema.extend({
  projectId: z.string().uuid().nullable(),
});
export type ListOpenLoopRow = z.infer<typeof ListOpenLoopRowSchema>;

export const SessionRowSchema = z.object({
  id: z.string().uuid(),
  device: z.string(),
  cwd: z.string().nullable(),
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  messageCount: z.number().int(),
  lastUserMessage: z.string().nullable(),
  summary: z.string().nullable(),
  projectName: z.string().nullable(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const InfraRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  endpoint: z.string().nullable(),
  metadata: z.unknown(),
  lastSeenAt: z.date().nullable(),
  projectName: z.string().nullable(),
});
export type InfraRow = z.infer<typeof InfraRowSchema>;

export const ProjectRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rootPath: z.string(),
  status: z.string().nullable(),
  kind: z.string().nullable(),
  framework: z.string().nullable(),
  primaryLang: z.string().nullable(),
  summary: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  lastCommitAt: z.date().nullable(),
  lastActivityAt: z.date().nullable(),
  todoCount: z.number().int().nullable(),
});
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const DirtyRepoRowSchema = z.object({
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  rootPath: z.string().nullable(),
  branch: z.string(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  upstream: z.string().nullable(),
});
export type DirtyRepoRow = z.infer<typeof DirtyRepoRowSchema>;

export const DepMatchRowSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
  isDev: z.boolean().nullable(),
  source: z.string().nullable(),
  projectName: z.string(),
  rootPath: z.string(),
});
export type DepMatchRow = z.infer<typeof DepMatchRowSchema>;

// ---------- per-tool input schemas ----------

export const StandupInputSchema = z
  .object({
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("Look-back window in days (default 7)"),
  })
  .strict();
export type StandupInput = z.infer<typeof StandupInputSchema>;

export const ProjectListInputSchema = z
  .object({
    status: z
      .enum(["active", "shipped", "prototype", "stale", "abandoned", "unknown"])
      .optional()
      .describe("Filter by project lifecycle status"),
    lang: z.string().optional().describe("Filter by primary language (e.g. 'typescript')"),
    framework: z.string().optional().describe("Filter by framework (e.g. 'next', 'vite')"),
    tag: z.string().optional().describe("Filter by tag"),
    search: z.string().optional().describe("Substring match on name or path"),
    limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
  })
  .strict();
export type ProjectListInput = z.infer<typeof ProjectListInputSchema>;

export const ProjectDetailInputSchema = z
  .object({
    idOrName: z.string().min(1).describe("Project UUID or exact name"),
  })
  .strict();
export type ProjectDetailInput = z.infer<typeof ProjectDetailInputSchema>;

export const AlertsInputSchema = z
  .object({
    status: z.enum(["open", "resolved"]).optional(),
    severity: z.enum(["urgent", "warn", "info"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type AlertsInput = z.infer<typeof AlertsInputSchema>;

export const OpenLoopsInputSchema = z
  .object({
    projectName: z.string().optional().describe("Filter to one project (exact match)"),
    source: z
      .enum(["todo_comment", "transcript", "alert", "note"])
      .optional()
      .describe("Filter by origin"),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type OpenLoopsInput = z.infer<typeof OpenLoopsInputSchema>;

export const DirtyReposInputSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type DirtyReposInput = z.infer<typeof DirtyReposInputSchema>;

export const TranscriptsInputSchema = z
  .object({
    days: z.number().int().min(1).max(30).optional().describe("Look-back window (default 7)"),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type TranscriptsInput = z.infer<typeof TranscriptsInputSchema>;

export const DepsAcrossInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .describe("Dependency name. Supports SQL LIKE wildcards: 'react%', '%eslint%'."),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type DepsAcrossInput = z.infer<typeof DepsAcrossInputSchema>;

// ---------- per-tool output schemas ----------

export const StandupSnapshotSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number().int(),
  alerts: z.array(AlertRowSchema),
  inFlight: z.array(InFlightProjectRowSchema),
  openLoops: z.array(OpenLoopRowSchema),
  recentSessions: z.array(SessionRowSchema),
  runningInfra: z.array(InfraRowSchema),
  staleCount: z.number().int(),
  abandonedCount: z.number().int(),
});
export type StandupSnapshot = z.infer<typeof StandupSnapshotSchema>;

export const ProjectListOutputSchema = z.object({
  count: z.number().int(),
  projects: z.array(ProjectRowSchema),
});
export type ProjectListOutput = z.infer<typeof ProjectListOutputSchema>;

// project_detail returns a heterogeneous bag — keep its shape loose since the
// underlying schema rows aren't worth re-deriving by hand. Wrapped in `passthrough`
// so callers see the data, just without strict validation on every field.
export const ProjectDetailOutputSchema = z
  .object({
    project: z.unknown(),
    dependencies: z.array(z.unknown()),
    branches: z.array(z.unknown()),
    recentCommits: z.array(z.unknown()),
    openLoops: z.array(z.unknown()),
    alerts: z.array(z.unknown()),
  })
  .or(z.object({ error: z.string() }));
export type ProjectDetailOutput = z.infer<typeof ProjectDetailOutputSchema>;

export const AlertsOutputSchema = z.object({
  count: z.number().int(),
  alerts: z.array(ListAlertRowSchema),
});
export type AlertsOutput = z.infer<typeof AlertsOutputSchema>;

export const OpenLoopsOutputSchema = z.object({
  count: z.number().int(),
  loops: z.array(ListOpenLoopRowSchema),
});
export type OpenLoopsOutput = z.infer<typeof OpenLoopsOutputSchema>;

export const DirtyReposOutputSchema = z.object({
  count: z.number().int(),
  dirty: z.array(DirtyRepoRowSchema),
});
export type DirtyReposOutput = z.infer<typeof DirtyReposOutputSchema>;

export const TranscriptsOutputSchema = z.object({
  count: z.number().int(),
  sessions: z.array(SessionRowSchema),
});
export type TranscriptsOutput = z.infer<typeof TranscriptsOutputSchema>;

export const DepsAcrossOutputSchema = z.object({
  count: z.number().int(),
  matches: z.array(DepMatchRowSchema),
});
export type DepsAcrossOutput = z.infer<typeof DepsAcrossOutputSchema>;

export const DoctorOutputSchema = z.object({
  database: z.object({
    reachable: z.boolean(),
    version: z.string().nullable(),
  }),
  projects: z.number().int(),
  openAlerts: z.number().int(),
  embeddings: z.number().int(),
  embedder: z.object({
    kind: z.string(),
  }),
});
export type DoctorOutput = z.infer<typeof DoctorOutputSchema>;
