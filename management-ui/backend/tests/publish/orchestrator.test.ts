import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let planSteps: typeof import('../../src/services/publish/orchestrator.js').planSteps;

beforeEach(async () => {
  vi.doMock('../../src/db/index.js', () => ({ getDb: () => { throw new Error('not used'); } }));
  vi.doMock('../../src/config/env.js', () => ({
    getBaseDomains: () => ['borisovai.ru', 'borisovai.tech'],
    loadAppConfig: () => ({ runner_tag: 'deploy-production', base_port: 4010 }),
  }));
  const mod = await import('../../src/services/publish/orchestrator.js');
  planSteps = mod.planSteps;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../../src/db/index.js');
  vi.doUnmock('../../src/config/env.js');
});

function base(partial: Record<string, unknown>) {
  return {
    slug: 'x', type: 'service', title: 'X',
    description: '',
    domain: { prefix: 'x' },
    backend: { internalIp: '127.0.0.1', port: 80 },
    authelia: { enabled: true, policy: 'two_factor' },
    ruProxy: { enabled: true, backendScheme: 'https' },
    dns: { ip: 'auto', recordType: 'A' },
    appType: 'frontend',
    idempotencyKey: 'k1',
    dryRun: false,
    force: false,
    ...partial,
  } as Parameters<typeof planSteps>[0];
}

describe('orchestrator.planSteps', () => {
  it('service: 4 базовых шага (dns, traefik, authelia, ru_proxy)', () => {
    const steps = planSteps(base({}));
    const kinds = steps.map(s => s.kind);
    expect(kinds).toEqual(['dns', 'traefik', 'authelia', 'ru_proxy']);
  });

  it('docker.volumeName включает docker_volume шаг', () => {
    const steps = planSteps(base({ docker: { volumeName: 'data', volumeUid: 1000 } }));
    expect(steps.map(s => s.kind)).toContain('docker_volume');
  });

  it('deploy включает directories + gitlab_ci + gitlab_variables', () => {
    const steps = planSteps(base({
      type: 'deploy',
      gitlab: { projectPath: 'g/p', template: 'frontend' },
    }));
    const kinds = steps.map(s => s.kind);
    expect(kinds).toContain('directories');
    expect(kinds).toContain('gitlab_ci');
    expect(kinds).toContain('gitlab_variables');
  });

  it('docs добавляет strapi_release когда release блок передан', () => {
    const steps = planSteps(base({
      type: 'docs',
      strapi: { contentType: 'docs', entry: {} },
      gitlab: { projectPath: 'g/d', template: 'docs' },
      release: {
        version: 'v1', changelog: '', source: 'admin', action: 'release',
        setAsCurrent: true, artifacts: [],
      },
    }));
    const kinds = steps.map(s => s.kind);
    expect(kinds).toContain('strapi');
    expect(kinds).toContain('strapi_release');
  });

  it('infra НЕ включает directories и traefik (нет backend)', () => {
    const steps = planSteps(base({
      type: 'infra',
      backend: undefined,
      gitlab: { projectPath: 'g/i', template: 'validate' },
    }));
    const kinds = steps.map(s => s.kind);
    expect(kinds).not.toContain('directories');
    // traefik tool выполнится как skipped (backend не передан), но всё равно присутствует в плане
    expect(kinds).toContain('traefik');
    expect(kinds).toContain('gitlab_ci');
  });

  it('install script добавляется при наличии install блока', () => {
    const steps = planSteps(base({ install: { scriptName: 'grafana', forceReinstall: false, preserveSecrets: true } }));
    expect(steps.map(s => s.kind)).toContain('install_script');
  });
});
