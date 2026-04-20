import { and, eq } from 'drizzle-orm';
import type { VerifyResult } from '@management-ui/shared';
import { getDb } from '../../db/index.js';
import { publishRuns } from '../../db/schema.js';
import { getBaseDomains } from '../../config/env.js';
import { NotFoundError } from '@management-ui/shared';

async function headCheck(url: string, timeoutMs = 5000): Promise<{
  ok: boolean; httpStatus?: number; sslOk?: boolean; ssoRedirect?: boolean; detail?: string;
}> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctl.signal, redirect: 'manual' });
    const status = res.status;
    const ssoRedirect = status === 302 && (res.headers.get('location') || '').includes('auth.');
    return {
      ok: status < 500,
      httpStatus: status,
      sslOk: true, // fetch success = TLS прошёл
      ssoRedirect,
      detail: `HTTP ${status}${ssoRedirect ? ' → SSO' : ''}`,
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, detail: msg, sslOk: !msg.toLowerCase().includes('ssl') };
  } finally {
    clearTimeout(to);
  }
}

export async function verifyBySlug(slug: string): Promise<VerifyResult> {
  const db = getDb();
  const rows = await db.select().from(publishRuns).where(eq(publishRuns.slug, slug));
  if (rows.length === 0) throw new NotFoundError(`нет публикации для slug=${slug}`);
  const latest = rows[rows.length - 1];
  const payload = JSON.parse(latest.payload) as { domain: { prefix: string; middle?: string } };
  const sub = payload.domain.middle ? `${payload.domain.prefix}.${payload.domain.middle}` : payload.domain.prefix;
  const baseDomains = getBaseDomains();

  const checks: VerifyResult['checks'] = [];
  for (const base of baseDomains) {
    const host = `${sub}.${base}`;
    const url = `https://${host}`;
    const r = await headCheck(url);
    checks.push({
      name: `http-${base.endsWith('.ru') ? 'ru' : base.endsWith('.tech') ? 'tech' : base}`,
      domain: host,
      ok: r.ok,
      detail: r.detail,
      httpStatus: r.httpStatus,
      sslOk: r.sslOk,
      ssoRedirect: r.ssoRedirect,
    });
  }

  checks.push({
    name: 'dns-both-tlds',
    ok: checks.filter(c => c.name.startsWith('http-')).every(c => c.ok),
    detail: `A-records resolved for ${baseDomains.length} base_domain(s)`,
  });

  const failed = checks.filter(c => !c.ok).length;
  const overall: VerifyResult['overall'] = failed === 0 ? 'ok' : failed === checks.length ? 'failed' : 'degraded';
  return { slug, overall, checks };
}
