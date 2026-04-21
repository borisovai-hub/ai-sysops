import { describe, it, expect } from 'vitest';
import {
  publishPayloadSchema, releaseSchema, uploadInitRequestSchema,
} from '@management-ui/shared';

describe('publishPayloadSchema', () => {
  it('валидирует минимальный service payload', () => {
    const r = publishPayloadSchema.safeParse({
      slug: 'grafana', type: 'service', title: 'Grafana',
      domain: { prefix: 'grafana', middle: 'dev' },
      backend: { internalIp: '127.0.0.1', port: 3000 },
      idempotencyKey: 'g-1',
    });
    expect(r.success).toBe(true);
  });

  it('требует backend для type=service', () => {
    const r = publishPayloadSchema.safeParse({
      slug: 'x', type: 'service', title: 'X',
      domain: { prefix: 'x' }, idempotencyKey: 'k1',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some(i => i.path.includes('backend'))).toBe(true);
    }
  });

  it('требует gitlab для type=deploy/docs/product/infra', () => {
    for (const type of ['deploy', 'docs', 'product', 'infra'] as const) {
      const r = publishPayloadSchema.safeParse({
        slug: 's', type, title: 'T',
        domain: { prefix: 's' }, idempotencyKey: `k-${type}`,
      });
      expect(r.success, `type=${type} должен требовать gitlab`).toBe(false);
    }
  });

  it('отклоняет невалидный slug', () => {
    const r = publishPayloadSchema.safeParse({
      slug: 'Invalid_Slug', type: 'service', title: 'T',
      domain: { prefix: 'x' },
      backend: { internalIp: '127.0.0.1', port: 80 },
      idempotencyKey: 'k',
    });
    expect(r.success).toBe(false);
  });

  it('применяет дефолты authelia и ruProxy', () => {
    const r = publishPayloadSchema.parse({
      slug: 'g', type: 'service', title: 'G',
      domain: { prefix: 'g' },
      backend: { internalIp: '127.0.0.1', port: 3000 },
      idempotencyKey: 'k',
    });
    expect(r.authelia?.enabled).toBe(true);
    expect(r.authelia?.policy).toBe('two_factor');
    expect(r.ruProxy?.enabled).toBe(true);
    expect(r.dns?.ip).toBe('auto');
    expect(r.dryRun).toBe(false);
  });

  it('прокидывает release блок', () => {
    const r = publishPayloadSchema.safeParse({
      slug: 'p', type: 'service', title: 'P',
      domain: { prefix: 'p' },
      backend: { internalIp: '127.0.0.1', port: 80 },
      idempotencyKey: 'k',
      release: {
        version: 'v1.0.0', changelog: 'init',
        source: 'admin', action: 'release',
        setAsCurrent: true,
        artifacts: [{
          artifact: { sourceUrl: 'https://x.tld/a.zip', filename: 'a.zip' },
          storage: { kind: 'downloads', visibility: 'public' },
        }],
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('releaseSchema', () => {
  it('принимает артефакт через uploadHandle', () => {
    const r = releaseSchema.safeParse({
      version: 'v1', changelog: '', source: 'admin', action: 'release',
      setAsCurrent: true,
      artifacts: [{
        artifact: { uploadHandle: 'upl_123', filename: 'x.bin' },
        storage: { kind: 'downloads', visibility: 'public' },
      }],
    });
    expect(r.success).toBe(true);
  });

  it('отклоняет артефакт без источника', () => {
    const r = releaseSchema.safeParse({
      version: 'v1', changelog: '', source: 'admin', action: 'release',
      setAsCurrent: true,
      artifacts: [{
        artifact: { filename: 'x.bin' },
        storage: { kind: 'downloads', visibility: 'public' },
      }],
    });
    expect(r.success).toBe(false);
  });

  it('отклоняет плохой checksum', () => {
    const r = releaseSchema.safeParse({
      version: 'v1', changelog: '', source: 'admin', action: 'release',
      setAsCurrent: true,
      artifacts: [{
        artifact: { sourceUrl: 'https://x.tld/a', filename: 'a', checksumSha256: 'not-hex' },
        storage: { kind: 'downloads', visibility: 'public' },
      }],
    });
    expect(r.success).toBe(false);
  });
});

describe('uploadInitRequestSchema', () => {
  it('валидирует корректный init', () => {
    const r = uploadInitRequestSchema.safeParse({
      slug: 'my-app', filename: 'x.zip', sizeBytes: 1024,
      contentType: 'application/zip',
      storage: { kind: 'downloads', visibility: 'public' },
      version: 'v1',
    });
    expect(r.success).toBe(true);
  });

  it('требует positive sizeBytes', () => {
    const r = uploadInitRequestSchema.safeParse({
      slug: 'x', filename: 'y.zip', sizeBytes: 0,
      storage: { kind: 'downloads', visibility: 'public' },
    });
    expect(r.success).toBe(false);
  });
});
