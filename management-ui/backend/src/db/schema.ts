import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// --- Auth tokens ---
export const authTokens = sqliteTable('auth_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  // JSON array of scopes, default ["*"] = full access (back-compat).
  // Known scopes: "publish:write", "admin:write", "*".
  scopes: text('scopes').notNull().default('["*"]'),
  createdAt: text('created_at').notNull(),
});

// --- Services (Traefik routers) ---
export const services = sqliteTable('services', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  domain: text('domain').notNull(),
  internalIp: text('internal_ip').notNull().default('127.0.0.1'),
  port: integer('port').notNull(),
  configFile: text('config_file').notNull(),
  routerName: text('router_name'),
  hasAuthelia: integer('has_authelia', { mode: 'boolean' }).notNull().default(false),
  isSystemService: integer('is_system_service', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Projects ---
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  gitlabProjectId: integer('gitlab_project_id').notNull(),
  projectType: text('project_type').notNull(),
  appType: text('app_type').notNull().default('frontend'),
  domain: text('domain'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  authelia: integer('authelia', { mode: 'boolean' }).notNull().default(true),
  pathWithNamespace: text('path_with_namespace'),
  defaultBranch: text('default_branch').notNull().default('main'),
  portFrontend: integer('port_frontend'),
  portBackend: integer('port_backend'),
  status: text('status').notNull().default('partial'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Project Steps ---
export const projectSteps = sqliteTable('project_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  stepName: text('step_name').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull(),
  detail: text('detail'),
  error: text('error'),
  updatedAt: text('updated_at').notNull(),
});

// --- Project Releases ---
export const projectReleases = sqliteTable('project_releases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  downloadUrl: text('download_url').notNull().default(''),
  changelog: text('changelog').notNull().default(''),
  source: text('source').notNull().default('unknown'),
  action: text('action').notNull().default('release'),
  strapiUpdated: integer('strapi_updated', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

// --- DNS Records (cache) ---
export const dnsRecords = sqliteTable('dns_records', {
  id: text('id').primaryKey(),
  subdomain: text('subdomain').notNull(),
  domain: text('domain').notNull(),
  type: text('type').notNull().default('A'),
  ip: text('ip').notNull(),
  createdAt: text('created_at'),
});

// --- Authelia Users ---
export const autheliaUsers = sqliteTable('authelia_users', {
  username: text('username').primaryKey(),
  displayname: text('displayname').notNull(),
  email: text('email').notNull().default(''),
  externalEmail: text('external_email'),
  passwordHash: text('password_hash').notNull(),
  groups: text('groups').notNull().default('[]'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  authPolicy: text('auth_policy').notNull().default('two_factor'),
  mailbox: text('mailbox'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- RU Proxy Domains (cache) ---
export const ruProxyDomains = sqliteTable('ru_proxy_domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  domain: text('domain').notNull().unique(),
  backend: text('backend'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// --- Config store ---
export const configEntries = sqliteTable('config_entries', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  source: text('source').notNull().default('config'),
  updatedAt: text('updated_at').notNull(),
});

// --- Agent Sessions ---
export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  model: text('model').notNull().default('claude-sonnet-4-20250514'),
  systemPrompt: text('system_prompt'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Agent Messages ---
export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | tool_call | tool_result
  content: text('content').notNull(),
  toolName: text('tool_name'),
  toolCallId: text('tool_call_id'),
  toolArgs: text('tool_args'),   // JSON
  toolTier: text('tool_tier'),   // auto | notify | approve
  createdAt: text('created_at').notNull(),
});

// --- Agent Approvals ---
export const agentApprovals = sqliteTable('agent_approvals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  toolArgs: text('tool_args').notNull(),
  tier: text('tier').notNull(), // auto | notify | approve
  status: text('status').notNull().default('pending'), // pending | approved | denied | expired
  reason: text('reason'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(),
});

// --- Audit log ---
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  user: text('user'),
  authMethod: text('auth_method'),
  details: text('details'),
  createdAt: text('created_at').notNull(),
});

// --- Health Checks (monitoring) ---
export const healthChecks = sqliteTable('health_checks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serviceName: text('service_name').notNull(),
  status: text('status').notNull(), // up | down | degraded
  responseTimeMs: integer('response_time_ms'),
  statusCode: integer('status_code'),
  error: text('error'),
  details: text('details'), // JSON
  checkedAt: text('checked_at').notNull(),
});

// --- Alerts ---
export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  severity: text('severity').notNull(), // info | warning | critical
  category: text('category').notNull(), // health | security | config
  source: text('source').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('active'), // active | acknowledged | resolved
  acknowledgedBy: text('acknowledged_by'),
  resolvedAt: text('resolved_at'),
  metadata: text('metadata'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Publish Runs (AI Publisher: идемпотентность + история прогонов) ---
export const publishRuns = sqliteTable('publish_runs', {
  id: text('id').primaryKey(), // pub_<ulid>
  idempotencyKey: text('idempotency_key').notNull().unique(),
  slug: text('slug').notNull(),
  type: text('type').notNull(), // service | deploy | docs | infra | product
  status: text('status').notNull().default('pending'), // pending|planning|running|waiting_approval|ok|partial|failed|rolled_back
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  payload: text('payload').notNull(), // JSON-сериализованный publish payload
  errors: text('errors').notNull().default('[]'), // JSON array of strings
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Publish Steps ---
export const publishSteps = sqliteTable('publish_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => publishRuns.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
  kind: text('kind').notNull(), // dns|traefik|authelia|...
  status: text('status').notNull().default('pending'), // pending|running|ok|skipped|error|rolled_back
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  detail: text('detail'),
  error: text('error'),
  before: text('before'), // JSON
  after: text('after'), // JSON
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(false),
});

// --- Publish Releases (версии проектов, привязаны к slug) ---
export const publishReleases = sqliteTable('publish_releases', {
  id: text('id').primaryKey(), // rel_<ulid>
  slug: text('slug').notNull(),
  version: text('version').notNull(),
  action: text('action').notNull().default('release'), // release|publish|unpublish
  source: text('source').notNull().default('admin'), // ci|agent|admin|unknown
  changelog: text('changelog').notNull().default(''),
  setAsCurrent: integer('set_as_current', { mode: 'boolean' }).notNull().default(true),
  strapiDocumentId: text('strapi_document_id'),
  strapiStatus: text('strapi_status').default('skipped'), // draft|published|unpublished|skipped
  runId: text('run_id').references(() => publishRuns.id, { onDelete: 'set null' }),
  releasedAt: text('released_at').notNull(),
  createdAt: text('created_at').notNull(),
});

// --- Publish Artifacts (файлы, привязанные к релизу) ---
export const publishArtifacts = sqliteTable('publish_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  releaseId: text('release_id').notNull().references(() => publishReleases.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  label: text('label'),
  platform: text('platform'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  checksumSha256: text('checksum_sha256'),
  storageKind: text('storage_kind').notNull().default('downloads'), // downloads|docs|media|custom
  storagePath: text('storage_path').notNull(),
  downloadUrl: text('download_url').notNull(),
  visibility: text('visibility').notNull().default('public'), // public|authelia|token
  contentType: text('content_type'),
  createdAt: text('created_at').notNull(),
});

// --- Publish Uploads (chunked resumable upload handles) ---
export const publishUploads = sqliteTable('publish_uploads', {
  handle: text('handle').primaryKey(), // upl_<ulid>
  slug: text('slug').notNull(),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  receivedBytes: integer('received_bytes').notNull().default(0),
  contentType: text('content_type'),
  checksumSha256: text('checksum_sha256'),
  storageKind: text('storage_kind').notNull().default('downloads'),
  storageVisibility: text('storage_visibility').notNull().default('public'),
  storageBasePath: text('storage_base_path'),
  version: text('version'),
  tempPath: text('temp_path').notNull(),
  status: text('status').notNull().default('active'), // active|completed|expired|failed
  expiresAt: text('expires_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});

// --- Security Events ---
export const securityEvents = sqliteTable('security_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(), // failed_login | brute_force | ip_blocked | unusual_traffic | config_anomaly
  severity: text('severity').notNull(), // low | medium | high | critical
  sourceIp: text('source_ip'),
  username: text('username'),
  serviceName: text('service_name'),
  description: text('description').notNull(),
  details: text('details'), // JSON
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});
