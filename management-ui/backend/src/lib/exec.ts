import { execSync, execFileSync } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  success: boolean;
  error?: string;
}

/**
 * Run a shell command synchronously. Returns stdout or throws.
 */
export function execCommand(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

/**
 * Run a shell command, returning result without throwing.
 */
export function execCommandSafe(cmd: string): ExecResult {
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    return { stdout, success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { stdout: '', success: false, error: message };
  }
}

/**
 * Run an executable with arguments (no shell injection).
 */
export function execFileSafe(binary: string, args: string[]): ExecResult {
  try {
    const stdout = execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { stdout, success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { stdout: '', success: false, error: message };
  }
}
