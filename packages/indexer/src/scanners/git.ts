import { simpleGit } from "simple-git";

export interface GitBranchInfo {
  name: string;
  headSha: string | null;
  isCurrent: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export interface GitSnapshot {
  remote: string | null;
  currentBranch: string | null;
  isDirty: boolean;
  branches: GitBranchInfo[];
  recentCommits: Array<{
    sha: string;
    author: string | null;
    message: string;
    committedAt: Date | null;
    parentShas: string[];
  }>;
}

export async function scanGit(rootPath: string, recentLimit = 50): Promise<GitSnapshot | null> {
  const git = simpleGit(rootPath);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) return null;

  const [status, remotes, branchSummary, log] = await Promise.all([
    git.status(),
    git.getRemotes(true),
    git.branch(),
    git.log({ maxCount: recentLimit }).catch(() => ({ all: [] as const })),
  ]);

  const originRemote = remotes.find((r) => r.name === "origin") ?? remotes[0];
  const remote = originRemote?.refs?.fetch ?? originRemote?.refs?.push ?? null;

  const branches: GitBranchInfo[] = Object.entries(branchSummary.branches).map(([name, b]) => ({
    name,
    headSha: b.commit ?? null,
    isCurrent: b.current,
    upstream: null,
    ahead: null,
    behind: null,
  }));

  const currentBranch = branchSummary.current || null;
  const currentBranchInfo = branches.find((b) => b.name === currentBranch);
  if (currentBranchInfo && status.tracking) {
    currentBranchInfo.upstream = status.tracking;
    currentBranchInfo.ahead = status.ahead;
    currentBranchInfo.behind = status.behind;
  }

  const recentCommits = [...(log.all ?? [])].map((c) => ({
    sha: c.hash,
    author: c.author_name || null,
    message: c.message,
    committedAt: c.date ? new Date(c.date) : null,
    parentShas: [],
  }));

  return {
    remote,
    currentBranch,
    isDirty: !status.isClean(),
    branches,
    recentCommits,
  };
}
