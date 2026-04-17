import { basename } from "node:path";
import { childLogger, type DetectedProject } from "@brain/shared";
import { getDb, schema } from "@brain/db";
import { eq, and, sql } from "drizzle-orm";
import { scanGit } from "./scanners/git.js";
import { scanManifests } from "./scanners/manifest.js";

export interface ScanResult {
  projectId: string;
  name: string;
  rootPath: string;
  dependenciesCount: number;
  branchesCount: number;
  isDirty: boolean;
  currentBranch: string | null;
  gitRemote: string | null;
}

export async function scanProject(detected: DetectedProject): Promise<ScanResult> {
  const db = getDb();
  const log = childLogger({ project: detected.name, path: detected.rootPath });

  const [git, manifest] = await Promise.all([
    scanGit(detected.rootPath).catch((err) => {
      log.warn({ err }, "git scan failed");
      return null;
    }),
    Promise.resolve(scanManifests(detected.rootPath)),
  ]);

  const [project] = await db
    .insert(schema.projects)
    .values({
      rootPath: detected.rootPath,
      name: detected.name || basename(detected.rootPath),
      kind: detected.kind,
      gitRemote: git?.remote ?? null,
      primaryLang: manifest.primaryLang,
      lastScannedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.projects.rootPath,
      set: {
        name: detected.name || basename(detected.rootPath),
        kind: detected.kind,
        gitRemote: git?.remote ?? null,
        primaryLang: manifest.primaryLang,
        lastScannedAt: new Date(),
      },
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

  // Upsert commits (only keep recent)
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

  await db.insert(schema.scanRuns).values({
    projectId,
    scanner: "phase1:git+manifest",
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
        scanner: "phase1:git+manifest",
        status: "error",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      });
      childLogger({ project: p.name }).error({ err }, "scan failed");
    }
  }
  return results;
}

export const _internal = { eq, and, sql };
