import { AppError } from '@management-ui/shared';
import { getGitStatus, getGitDiff, getGitLog, commitChanges, pushChanges } from '../lib/git.js';
import { revertCommit } from '../lib/gitops.js';

/**
 * Get git status for the infrastructure repository.
 */
export async function status() {
  return await getGitStatus();
}

/**
 * Get unified diff (all changes or specific file).
 */
export async function diff(file?: string) {
  return await getGitDiff(file);
}

/**
 * Get git log (last N commits).
 */
export async function log(maxCount?: number) {
  return await getGitLog(maxCount);
}

/**
 * Stage files and commit.
 */
export async function commit(files: string[], message: string) {
  if (!files || files.length === 0) {
    throw new AppError('Необходимо указать файлы для коммита');
  }
  if (!message || !message.trim()) {
    throw new AppError('Необходимо указать сообщение коммита');
  }
  return await commitChanges(files, message);
}

/**
 * Push to remote.
 */
export async function push(remote?: string, branch?: string) {
  return await pushChanges(remote, branch);
}

/**
 * Revert a commit by hash.
 */
export async function revert(hash: string) {
  if (!hash || !hash.trim()) {
    throw new AppError('Необходимо указать хеш коммита');
  }
  return await revertCommit(hash.trim());
}
