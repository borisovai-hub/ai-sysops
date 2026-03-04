import { eq, and, desc, sql, count } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';

type AlertSelect = typeof schema.alerts.$inferSelect;

export async function createAlert(params: {
  severity: string;
  category: string;
  source: string;
  title: string;
  message: string;
  metadata?: string;
}): Promise<AlertSelect> {
  const db = getDb();
  const now = new Date().toISOString();

  // Deduplicate: don't create if active alert for same source+category exists
  const [existing] = await db.select().from(schema.alerts)
    .where(and(
      eq(schema.alerts.source, params.source),
      eq(schema.alerts.category, params.category),
      eq(schema.alerts.status, 'active'),
    ));

  if (existing) {
    // Update existing alert's timestamp and metadata
    await db.update(schema.alerts)
      .set({ updatedAt: now, metadata: params.metadata ?? existing.metadata })
      .where(eq(schema.alerts.id, existing.id));
    return { ...existing, updatedAt: now };
  }

  const [result] = await db.insert(schema.alerts).values({
    ...params,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }).returning();

  return result;
}

export async function getAlerts(filters?: {
  status?: string;
  severity?: string;
  category?: string;
  limit?: number;
}): Promise<AlertSelect[]> {
  const db = getDb();
  const conditions = [];
  if (filters?.status) conditions.push(eq(schema.alerts.status, filters.status));
  if (filters?.severity) conditions.push(eq(schema.alerts.severity, filters.severity));
  if (filters?.category) conditions.push(eq(schema.alerts.category, filters.category));

  let query = db.select().from(schema.alerts);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }
  return query.orderBy(desc(schema.alerts.createdAt)).limit(filters?.limit ?? 100);
}

export async function getActiveAlerts(): Promise<AlertSelect[]> {
  return getAlerts({ status: 'active' });
}

export async function acknowledgeAlert(id: number, user: string): Promise<AlertSelect | undefined> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.update(schema.alerts)
    .set({ status: 'acknowledged', acknowledgedBy: user, updatedAt: now })
    .where(eq(schema.alerts.id, id));
  const [row] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, id));
  return row;
}

export async function resolveAlert(id: number): Promise<AlertSelect | undefined> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.update(schema.alerts)
    .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
    .where(eq(schema.alerts.id, id));
  const [row] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, id));
  return row;
}

export async function resolveAlertsBySource(source: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.update(schema.alerts)
    .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
    .where(and(
      eq(schema.alerts.source, source),
      eq(schema.alerts.status, 'active'),
    ));
}

export async function getAlertStats(): Promise<{ active: number; acknowledged: number; resolvedToday: number }> {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const [activeRow] = await db.select({ total: count() }).from(schema.alerts)
    .where(eq(schema.alerts.status, 'active'));
  const [ackRow] = await db.select({ total: count() }).from(schema.alerts)
    .where(eq(schema.alerts.status, 'acknowledged'));
  const [resolvedRow] = await db.select({ total: count() }).from(schema.alerts)
    .where(and(
      eq(schema.alerts.status, 'resolved'),
      sql`${schema.alerts.resolvedAt} >= ${today}`,
    ));

  return {
    active: activeRow?.total ?? 0,
    acknowledged: ackRow?.total ?? 0,
    resolvedToday: resolvedRow?.total ?? 0,
  };
}

export async function cleanupResolvedAlerts(retentionDays: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();

  // Count before delete (libsql drizzle doesn't expose changes count directly)
  const [before] = await db.select({ total: count() }).from(schema.alerts)
    .where(and(
      eq(schema.alerts.status, 'resolved'),
      sql`${schema.alerts.resolvedAt} < ${cutoff}`,
    ));
  const toDelete = before?.total ?? 0;

  if (toDelete > 0) {
    await db.delete(schema.alerts)
      .where(and(
        eq(schema.alerts.status, 'resolved'),
        sql`${schema.alerts.resolvedAt} < ${cutoff}`,
      ));
  }

  return toDelete;
}
