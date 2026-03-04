/**
 * Centralized logger.
 *
 * NOTE: pino is NOT in direct dependencies yet (only transitive via fastify).
 * Using a console-based shim with the same interface.
 * When pino is added to dependencies, replace the body with:
 *   import pino from 'pino';
 *   export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
 */

const level = process.env.LOG_LEVEL || 'info';

const LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const currentLevel = LEVELS[level] ?? 30;

function shouldLog(lvl: string): boolean {
  return (LEVELS[lvl] ?? 30) >= currentLevel;
}

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    if (shouldLog('info')) console.info(`[INFO] ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    if (shouldLog('warn')) console.warn(`[WARN] ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    if (shouldLog('error')) console.error(`[ERROR] ${msg}`, ...args);
  },
  debug(msg: string, ...args: unknown[]): void {
    if (shouldLog('debug')) console.debug(`[DEBUG] ${msg}`, ...args);
  },
};
