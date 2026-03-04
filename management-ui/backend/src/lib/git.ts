import { resolve } from 'node:path';
import simpleGit, { type SimpleGit, type StatusResult, type DefaultLogFields, type ListLogLine } from 'simple-git';
import { getRepoDir, getServerConfigDir } from '../config/env.js';

let gitInstance: SimpleGit | null = null;

/**
 * Get a simple-git instance for the borisovai-admin repository.
 */
export function getGit(): SimpleGit {
  if (!gitInstance) {
    const repoDir = getRepoDir();
    if (!repoDir) throw new Error('Repository directory not found');
    gitInstance = simpleGit(repoDir);
  }
  return gitInstance;
}

let configGitInstance: SimpleGit | null = null;

/**
 * Get a simple-git instance for the server-configs repository.
 * The repo root is two levels up from the server config dir (servers/<name>/).
 */
export function getConfigGit(): SimpleGit {
  if (!configGitInstance) {
    const serverDir = getServerConfigDir();
    if (!serverDir) throw new Error('Server config directory not found');
    const repoRoot = resolve(serverDir, '../..');
    configGitInstance = simpleGit(repoRoot);
  }
  return configGitInstance;
}

export interface GitFileStatus {
  path: string;
  index: string;
  working_dir: string;
}

/**
 * Get git status for the repository.
 */
export async function getGitStatus(): Promise<{
  files: GitFileStatus[];
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
}> {
  const git = getGit();
  const status: StatusResult = await git.status();
  return {
    files: status.files.map(f => ({
      path: f.path,
      index: f.index,
      working_dir: f.working_dir,
    })),
    current: status.current,
    tracking: status.tracking,
    ahead: status.ahead,
    behind: status.behind,
  };
}

/**
 * Get unified diff for all changes or a specific file.
 */
export async function getGitDiff(file?: string): Promise<string> {
  const git = getGit();
  const args = file ? [file] : [];
  return await git.diff(args);
}

/**
 * Get git log (last N commits).
 */
export async function getGitLog(maxCount = 20): Promise<Array<{
  hash: string;
  date: string;
  message: string;
  author_name: string;
}>> {
  const git = getGit();
  const log = await git.log({ maxCount });
  return log.all.map((entry: DefaultLogFields & ListLogLine) => ({
    hash: entry.hash,
    date: entry.date,
    message: entry.message,
    author_name: entry.author_name,
  }));
}

/**
 * Stage files and create a commit.
 */
export async function commitChanges(
  files: string[],
  message: string,
): Promise<{ hash: string; summary: string }> {
  const git = getGit();
  await git.add(files);
  const result = await git.commit(message);
  return {
    hash: result.commit || '',
    summary: `${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`,
  };
}

/**
 * Push to remote.
 */
export async function pushChanges(
  remote = 'origin',
  branch?: string,
): Promise<{ success: boolean; detail: string }> {
  const git = getGit();
  const status = await git.status();
  const targetBranch = branch || status.current || 'main';
  try {
    await git.push(remote, targetBranch);
    return { success: true, detail: `Pushed to ${remote}/${targetBranch}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, detail: message };
  }
}
