import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const AUDIT_LOG = process.env.NODE_AGENT_AUDIT_LOG || '/var/log/node-agent/audit.log';

let initialized = false;
function ensureInit() {
  if (initialized) return;
  try {
    mkdirSync(dirname(AUDIT_LOG), { recursive: true });
  } catch {
    // ignore
  }
  initialized = true;
}

export function audit(entry: {
  clientSan: string | null;
  method: string;
  path: string;
  bodyHash?: string;
  statusCode: number;
}): void {
  ensureInit();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  }) + '\n';
  try {
    appendFileSync(AUDIT_LOG, line);
  } catch {
    // never crash on audit failure
  }
}

export function hashBody(raw: string | Buffer | undefined): string | undefined {
  if (!raw) return undefined;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
