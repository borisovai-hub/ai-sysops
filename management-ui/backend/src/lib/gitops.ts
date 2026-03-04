import { resolve, relative, normalize } from 'node:path';
import { PATHS, AppError } from '@management-ui/shared';
import { getGit, getConfigGit } from './git.js';
import { getServerConfigDir } from '../config/env.js';

/**
 * Determine which git repo a file belongs to and return the appropriate
 * simple-git instance + repo root path.
 */
function selectRepo(filePath: string): { git: ReturnType<typeof getGit>; root: string } {
  const serverDir = getServerConfigDir();
  if (serverDir) {
    const configRepoRoot = resolve(serverDir, '../..');
    const normalizedFile = normalize(filePath);
    const normalizedRoot = normalize(configRepoRoot);
    if (normalizedFile.startsWith(normalizedRoot)) {
      return { git: getConfigGit(), root: configRepoRoot };
    }
  }
  return { git: getGit(), root: PATHS.REPO_DIR };
}

/**
 * Commit config changes — auto-selects between borisovai-admin and server-configs repo.
 * @param filePaths - absolute paths to changed files
 * @param message - commit message
 */
export async function commitConfigChange(
  filePaths: string[],
  message: string,
): Promise<{ hash: string; summary: string }> {
  const { git, root } = selectRepo(filePaths[0]);
  const relativePaths = filePaths.map((fp) => relative(root, fp));
  await git.add(relativePaths);
  const result = await git.commit(message);
  return {
    hash: result.commit || '',
    summary: `${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`,
  };
}

/**
 * Revert a commit by hash using `git revert --no-edit`.
 * Returns the new revert commit hash.
 */
export async function revertCommit(hash: string): Promise<{ hash: string }> {
  if (!/^[a-f0-9]{7,40}$/.test(hash)) {
    throw new AppError('Некорректный формат хеша коммита');
  }
  const git = getGit();
  await git.revert(hash, { '--no-edit': null });
  const log = await git.log({ maxCount: 1 });
  return { hash: log.latest?.hash || '' };
}
