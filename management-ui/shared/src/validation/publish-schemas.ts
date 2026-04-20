import { z } from 'zod';

// =============================================================================
// AI Publisher — единый контракт публикации сервисов и проектов
// =============================================================================
// Используется:
//   - backend: валидация POST /api/publish/* (routes/publish.ts)
//   - frontend: генерация форм /publish + клиентская валидация
//   - docs: источник для AGENT_PUBLISH_API.md (JSON-схемы)
//   - AI agent: tool-схемы для LLM через GET /api/publish/schema
// =============================================================================

// --- Базовые enum'ы ---

export const publishTypeEnum = z.enum([
  'service',   // инфрасервис (Grafana, Vikunja-like) — DNS + Traefik + Authelia + install-script
  'deploy',    // веб-приложение пользователя — полный цикл (DNS+Traefik+Dir+CI)
  'docs',      // документация (Strapi+CI+Dir)
  'infra',     // инфра-проект (только CI)
  'product',   // продукт с загрузками (Strapi+CI+Dir+Downloads)
]);

export const appTypeEnum = z.enum(['frontend', 'backend', 'fullstack']);

export const autheliaPolicyEnum = z.enum(['bypass', 'one_factor', 'two_factor']);

export const ciTemplateEnum = z.enum([
  'frontend', 'backend', 'fullstack',
  'docs', 'validate', 'product',
]);

export const strapiContentTypeEnum = z.enum(['project', 'docs', 'product']);

export const publishStatusEnum = z.enum([
  'pending', 'planning', 'running', 'waiting_approval',
  'ok', 'partial', 'failed', 'rolled_back',
]);

export const stepStatusEnum = z.enum([
  'pending', 'running', 'ok', 'skipped', 'error', 'rolled_back',
]);

export const stepKindEnum = z.enum([
  'dns', 'traefik', 'authelia', 'ru_proxy', 'docker', 'docker_volume',
  'gitlab_ci', 'gitlab_variables', 'strapi', 'directories',
  'install_script', 'config_repo_commit', 'verify',
  'storage_upload', 'strapi_release', 'strapi_publish',
]);

export const releaseActionEnum = z.enum(['release', 'publish', 'unpublish']);
export const releaseSourceEnum = z.enum(['ci', 'agent', 'admin', 'unknown']);
export const storageKindEnum = z.enum(['downloads', 'docs', 'media', 'custom']);
export const artifactVisibilityEnum = z.enum(['public', 'authelia', 'token']);

// --- Подблоки payload ---

const slugSchema = z.string()
  .min(1, 'Slug обязателен')
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Только строчные буквы, цифры, дефисы');

const domainSchema = z.object({
  prefix: z.string()
    .min(1, 'Префикс домена обязателен')
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Только строчные буквы, цифры, дефисы'),
  middle: z.string()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Некорректный middle-сегмент')
    .optional(),
});

const backendSchema = z.object({
  internalIp: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(1).max(65535),
});

const autheliaSchema = z.object({
  enabled: z.boolean().default(true),
  policy: autheliaPolicyEnum.default('two_factor'),
  oidcClientId: z.string().optional(),
});

const ruProxySchema = z.object({
  enabled: z.boolean().default(true),
  backendScheme: z.enum(['http', 'https']).default('https'),
});

const dnsSchema = z.object({
  ip: z.union([z.literal('auto'), z.string().min(1)]).default('auto'),
  recordType: z.enum(['A', 'AAAA', 'CNAME']).default('A'),
});

const dockerSchema = z.object({
  composePath: z.string().optional(),
  volumeName: z.string().optional(),
  volumeUid: z.number().int().nonnegative().optional(),
  volumeGid: z.number().int().nonnegative().optional(),
});

const strapiSchema = z.object({
  contentType: strapiContentTypeEnum,
  entry: z.record(z.string(), z.unknown()).default({}),
});

const gitlabSchema = z.object({
  projectId: z.number().int().positive().optional(),
  projectPath: z.string().optional(),
  template: ciTemplateEnum,
  variables: z.record(z.string(), z.string()).optional(),
  frontendEnv: z.string().optional(),
  backendEnv: z.string().optional(),
}).refine(
  (d) => d.projectId != null || d.projectPath != null,
  { message: 'gitlab.projectId или gitlab.projectPath обязателен', path: ['projectId'] },
);

const installScriptSchema = z.object({
  scriptName: z.string()
    .regex(/^[a-z0-9-]+$/, 'Только строчные буквы, цифры, дефисы')
    .refine(n => !n.startsWith('-'), 'Имя не должно начинаться с дефиса'),
  forceReinstall: z.boolean().default(false),
  preserveSecrets: z.boolean().default(true),
});

// --- Artifacts / storage / release ---

const artifactSchema = z.object({
  // Источник файла: либо URL (CI artifact, remote), либо уже загруженный handle,
  // либо локальный абсолютный путь (только серверные вызовы).
  sourceUrl: z.string().url().optional(),
  sourcePath: z.string().optional(),
  uploadHandle: z.string().optional(), // id после чанкового multipart upload
  filename: z.string().min(1).max(255),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).refine(
  (d) => d.sourceUrl || d.sourcePath || d.uploadHandle,
  { message: 'artifact: нужен sourceUrl, sourcePath или uploadHandle', path: ['sourceUrl'] },
);

const storageTargetSchema = z.object({
  kind: storageKindEnum.default('downloads'),
  // Итоговый путь строится: /var/www/<kind>/<slug>/<version>/<filename>
  // Можно переопределить полный путь; API валидирует, что он в разрешённой базе.
  basePath: z.string().optional(),
  visibility: artifactVisibilityEnum.default('public'),
  publicUrlPrefix: z.string().optional(), // например "/downloads" или "/docs"
  overwrite: z.boolean().default(false),
});

export const releaseSchema = z.object({
  version: z.string().min(1).max(64), // семвер/тег, e.g. "v1.2.0"
  changelog: z.string().default(''),
  source: releaseSourceEnum.default('admin'),
  action: releaseActionEnum.default('release'),
  releasedAt: z.string().datetime().optional(),
  // Если задан — проверить/обновить поле version в существующем Strapi entry.
  setAsCurrent: z.boolean().default(true),
  // Список артефактов релиза; публикуются в storage и регистрируются в Strapi downloads[].
  artifacts: z.array(z.object({
    artifact: artifactSchema,
    storage: storageTargetSchema,
    label: z.string().optional(), // "Windows installer", "Linux AppImage"...
    platform: z.string().optional(), // "windows", "linux", "macos", "docker"
    downloadUrl: z.string().url().optional(), // если уже размещён снаружи (GitHub Releases)
  })).default([]),
});
export type ReleasePayload = z.infer<typeof releaseSchema>;

// --- Главная схема payload (единая для всех типов) ---

export const publishPayloadSchema = z.object({
  slug: slugSchema,
  type: publishTypeEnum,
  title: z.string().min(1, 'Заголовок обязателен').max(200),
  description: z.string().max(1000).default(''),

  domain: domainSchema,
  backend: backendSchema.optional(),
  appType: appTypeEnum.default('frontend'),

  authelia: autheliaSchema.default({ enabled: true, policy: 'two_factor' }),
  ruProxy: ruProxySchema.default({ enabled: true, backendScheme: 'https' }),
  dns: dnsSchema.default({ ip: 'auto', recordType: 'A' }),
  docker: dockerSchema.optional(),
  strapi: strapiSchema.optional(),
  gitlab: gitlabSchema.optional(),
  install: installScriptSchema.optional(),

  // Релиз (версия + артефакты) в рамках одного прогона публикации.
  // Используется как для первой публикации (initial release), так и для последующих.
  release: releaseSchema.optional(),

  idempotencyKey: z.string().min(1).max(128),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
}).superRefine((data, ctx) => {
  // Правила консистентности по типу публикации.
  if (data.type === 'service') {
    if (!data.backend) {
      ctx.addIssue({ code: 'custom', path: ['backend'],
        message: 'backend обязателен для type=service' });
    }
  }
  if (data.type === 'deploy') {
    if (!data.gitlab) {
      ctx.addIssue({ code: 'custom', path: ['gitlab'],
        message: 'gitlab обязателен для type=deploy' });
    }
  }
  if (data.type === 'docs' || data.type === 'product') {
    if (!data.strapi) {
      ctx.addIssue({ code: 'custom', path: ['strapi'],
        message: 'strapi обязателен для type=docs/product' });
    }
    if (!data.gitlab) {
      ctx.addIssue({ code: 'custom', path: ['gitlab'],
        message: 'gitlab обязателен для type=docs/product' });
    }
  }
  if (data.type === 'infra' && !data.gitlab) {
    ctx.addIssue({ code: 'custom', path: ['gitlab'],
      message: 'gitlab обязателен для type=infra' });
  }
});

export type PublishPayload = z.infer<typeof publishPayloadSchema>;

// --- Ответные схемы (для документации API) ---

export const publishStepSchema = z.object({
  kind: stepKindEnum,
  status: stepStatusEnum,
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  detail: z.string().optional(),
  error: z.string().optional(),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
});
export type PublishStep = z.infer<typeof publishStepSchema>;

export const publishRunSchema = z.object({
  id: z.string(),
  idempotencyKey: z.string(),
  slug: z.string(),
  type: publishTypeEnum,
  status: publishStatusEnum,
  dryRun: z.boolean(),
  steps: z.array(publishStepSchema),
  errors: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  payload: publishPayloadSchema.optional(),
});
export type PublishRun = z.infer<typeof publishRunSchema>;

// --- LLM / AI endpoint ---

export const publishAiRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  approvals: z.enum(['auto_safe', 'manual', 'auto_all']).default('auto_safe'),
  context: z.object({
    gitlabProjectPath: z.string().optional(),
    preferredType: publishTypeEnum.optional(),
  }).optional(),
});
export type PublishAiRequest = z.infer<typeof publishAiRequestSchema>;

export const approvalDecisionSchema = z.object({
  runId: z.string(),
  stepKind: stepKindEnum,
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

// --- Verify / Rollback ---

export const verifyResultSchema = z.object({
  slug: z.string(),
  checks: z.array(z.object({
    name: z.string(),
    domain: z.string().optional(),
    ok: z.boolean(),
    detail: z.string().optional(),
    httpStatus: z.number().int().optional(),
    sslOk: z.boolean().optional(),
    ssoRedirect: z.boolean().optional(),
  })),
  overall: z.enum(['ok', 'degraded', 'failed']),
});
export type VerifyResult = z.infer<typeof verifyResultSchema>;

export const rollbackRequestSchema = z.object({
  confirmDestructive: z.boolean().default(false),
  onlyKinds: z.array(stepKindEnum).optional(),
});
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;

// --- Release / Artifacts отдельные endpoint'ы ---

export const createReleaseRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(128),
  dryRun: z.boolean().default(false),
  release: releaseSchema,
  // Обновить материал на сайте (Strapi entry: version, changelog, downloads[]).
  updateStrapi: z.boolean().default(true),
  // Публиковать ли draft сразу (иначе остаётся на модерации).
  publishToSite: z.boolean().default(false),
});
export type CreateReleaseRequest = z.infer<typeof createReleaseRequestSchema>;

export const uploadInitRequestSchema = z.object({
  slug: z.string().min(1),
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentType: z.string().optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  storage: storageTargetSchema,
  version: z.string().min(1).max(64).optional(),
});
export type UploadInitRequest = z.infer<typeof uploadInitRequestSchema>;

export const uploadInitResponseSchema = z.object({
  uploadHandle: z.string(),
  uploadUrl: z.string().url().optional(), // для direct PUT (chunked/resumable)
  chunkSize: z.number().int().positive().optional(),
  expiresAt: z.string().datetime(),
});
export type UploadInitResponse = z.infer<typeof uploadInitResponseSchema>;

export const releaseInfoSchema = z.object({
  slug: z.string(),
  version: z.string(),
  action: releaseActionEnum,
  source: releaseSourceEnum,
  changelog: z.string(),
  releasedAt: z.string().datetime(),
  strapiDocumentId: z.string().optional(),
  strapiStatus: z.enum(['draft', 'published', 'unpublished', 'skipped']).optional(),
  artifacts: z.array(z.object({
    filename: z.string(),
    label: z.string().optional(),
    platform: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
    checksumSha256: z.string().optional(),
    storagePath: z.string(),
    downloadUrl: z.string(),
    visibility: artifactVisibilityEnum,
  })),
  createdAt: z.string().datetime(),
});
export type ReleaseInfo = z.infer<typeof releaseInfoSchema>;
