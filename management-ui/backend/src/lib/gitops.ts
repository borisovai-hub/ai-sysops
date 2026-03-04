import { relative } from 'node:path';
import { PATHS, AppError } from '@management-ui/shared';
import { getGit } from './git.js';

/**
 * Commit config changes to the borisovai-admin repo.
 * @param filePaths - absolute paths to changed files
 * @param message - commit message
 */
export async function commitConfigChange(
  filePaths: string[],
  message: string,
): Promise<{ hash: string; summary: string }> {
  const git = getGit();
  const relativePaths = filePaths.map((fp) => relative(PATHS.REPO_DIR, fp));
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
