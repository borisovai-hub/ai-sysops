import { z } from 'zod';

// --- Auth ---
export const createTokenSchema = z.object({
  name: z.string().min(1, 'Имя обязательно').max(100),
});

// --- Services ---
export const createServiceSchema = z.object({
  name: z.string()
    .min(1, 'Имя обязательно')
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Только строчные буквы, цифры и дефисы'),
  domain: z.string().optional().default(''),
  internalIp: z.string().min(1).default('127.0.0.1'),
  port: z.string().min(1, 'Порт обязателен'),
  authelia: z.boolean().default(false),
});

export const updateServiceSchema = z.object({
  domain: z.string().optional(),
  internalIp: z.string().min(1),
  port: z.string().min(1),
});

// --- DNS ---
const dnsTypeEnum = z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']);

export const createDnsRecordSchema = z.object({
  subdomain: z.string().default(''),
  domain: z.string().optional(),
  type: dnsTypeEnum.default('A'),
  ip: z.string().min(1, 'IP/значение обязательно'),
});

export const updateDnsRecordSchema = z.object({
  subdomain: z.string().optional(),
  domain: z.string().optional(),
  type: dnsTypeEnum.optional(),
  ip: z.string().min(1).optional(),
});

// --- Projects ---
export const publishProjectSchema = z.object({
  slug: z.string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Только строчные буквы, цифры и дефисы'),
  // Accept both frontend naming (gitlabProject string) and direct ID
  gitlabProjectId: z.number().int().positive().optional(),
  gitlabProject: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  // Accept both 'type' and 'projectType'
  projectType: z.enum(['deploy', 'docs', 'infra', 'product']).optional(),
  type: z.enum(['deploy', 'docs', 'infra', 'product']).optional(),
  appType: z.enum(['frontend', 'backend', 'fullstack']).default('frontend'),
  title: z.string().min(1, 'Заголовок обязателен'),
  description: z.string().default(''),
  authelia: z.boolean().default(true),
  force: z.boolean().optional(),
}).refine(
  (d) => d.gitlabProjectId != null || d.gitlabProject != null,
  { message: 'gitlabProjectId или gitlabProject обязателен', path: ['gitlabProject'] },
).refine(
  (d) => d.projectType != null || d.type != null,
  { message: 'projectType обязателен', path: ['projectType'] },
);

export const releaseProjectSchema = z.object({
  version: z.string().min(1, 'Версия обязательна'),
  downloadUrl: z.string().url().optional().or(z.literal('')),
  changelog: z.string().default(''),
  source: z.enum(['ci', 'agent', 'admin', 'unknown']).default('admin'),
  action: z.enum(['release', 'publish', 'unpublish']).default('release'),
});

// --- Users ---
export const createUserSchema = z.object({
  username: z.string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'Только строчные буквы, цифры, ._-'),
  displayname: z.string().optional().default(''),
  displayName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  password: z.string().min(8, 'Минимум 8 символов'),
  groups: z.array(z.string()).default([]),
  mailbox: z.string().optional(),
});

export const updateUserSchema = z.object({
  displayname: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  groups: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  mailbox: z.string().optional(),
});

export const changePasswordSchema = z.object({
  password: z.string().min(8, 'Минимум 8 символов'),
});

// --- RU Proxy ---
export const addDomainSchema = z.object({
  domain: z.string().min(1, 'Домен обязателен'),
  backend: z.string().optional(),
});

export const updateDomainSchema = z.object({
  backend: z.string().optional(),
  enabled: z.boolean().optional(),
});

// --- Files ---
export const deleteFileSchema = z.object({
  path: z.string().min(1, 'Путь обязателен'),
});

export const createDirSchema = z.object({
  path: z.string().min(1, 'Путь обязателен'),
});

export const renameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

// --- Git ---
export const commitSchema = z.object({
  files: z.array(z.string()).min(1, 'Выберите хотя бы один файл'),
  message: z.string().min(1, 'Сообщение коммита обязательно').max(500),
});

export const pushSchema = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
});

export const revertSchema = z.object({
  hash: z.string().min(1, 'Хеш коммита обязателен'),
});

// --- Notifier ---
export const updateNotifierSchema = z.object({
  type: z.enum(['filesystem', 'smtp']),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().optional(),
    sender: z.string().min(1),
    username: z.string().optional(),
    password: z.string().optional(),
    tls_skip_verify: z.boolean().optional(),
  }).optional(),
});

// --- Agent ---
export const createSessionSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export const chatMessageSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1, 'Сообщение обязательно'),
});
