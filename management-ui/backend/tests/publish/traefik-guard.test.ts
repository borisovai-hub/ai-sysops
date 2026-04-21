import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let createTraefikConfig: typeof import('../../src/lib/traefik.js').createTraefikConfig;
let findServiceConfig: typeof import('../../src/lib/traefik.js').findServiceConfig;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'traefik-test-'));
  // mock config/env перед import
  vi.doMock('../../src/config/env.js', () => ({
    getTraefikConfigDir: () => tmpDir,
    isGitOpsMode: () => true, // чтобы reloadTraefik не вызывал systemctl
    getBaseDomains: () => ['borisovai.ru', 'borisovai.tech'],
  }));
  const mod = await import('../../src/lib/traefik.js');
  createTraefikConfig = mod.createTraefikConfig;
  findServiceConfig = mod.findServiceConfig;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../../src/config/env.js');
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('Traefik config: оба TLD', () => {
  it('rule содержит оба base_domain при мульти-домене', () => {
    const domainStr = 'grafana.borisovai.ru,grafana.borisovai.tech';
    const r = createTraefikConfig('grafana', domainStr, '127.0.0.1', 3000);
    const yaml = readFileSync(r.configPath, 'utf-8');
    expect(yaml).toContain('grafana.borisovai.ru');
    expect(yaml).toContain('grafana.borisovai.tech');
    expect(yaml).toMatch(/Host\(`grafana\.borisovai\.ru`\)[\s\S]*\|\|[\s\S]*Host\(`grafana\.borisovai\.tech`\)/);
  });

  it('authelia middleware добавляется по флагу', () => {
    const r = createTraefikConfig('x', 'x.borisovai.ru,x.borisovai.tech', '127.0.0.1', 80, { authelia: true });
    const yaml = readFileSync(r.configPath, 'utf-8');
    expect(yaml).toContain('authelia@file');
  });

  it('без authelia флага middleware не пишется', () => {
    const r = createTraefikConfig('y', 'y.borisovai.ru', '127.0.0.1', 80);
    const yaml = readFileSync(r.configPath, 'utf-8');
    expect(yaml).not.toContain('authelia');
  });
});

describe('findServiceConfig: multi-router YAML', () => {
  it('находит роутер в собственном файле', () => {
    const path = join(tmpDir, 'svc.yml');
    writeFileSync(path, 'http:\n  routers:\n    svc:\n      rule: Host(`a`)\n      service: svc\n', 'utf-8');
    const r = findServiceConfig('svc');
    expect(r).not.toBeNull();
    expect(r!.configFile).toBe('svc.yml');
  });

  it('находит роутер внутри мульти-роутерного файла', () => {
    const path = join(tmpDir, 'analytics.yml');
    writeFileSync(path, [
      'http:',
      '  routers:',
      '    analytics-ru:',
      '      rule: Host(`analytics.borisovai.ru`)',
      '      service: analytics',
      '    analytics-tech:',
      '      rule: Host(`analytics.borisovai.tech`)',
      '      service: analytics',
    ].join('\n'), 'utf-8');
    const r = findServiceConfig('analytics-ru');
    expect(r).not.toBeNull();
    expect(r!.configFile).toBe('analytics.yml');
    expect(r!.routerName).toBe('analytics-ru');
  });

  it('возвращает null для несуществующего роутера', () => {
    expect(findServiceConfig('ghost')).toBeNull();
  });

  it('игнорирует повреждённые YAML', () => {
    writeFileSync(join(tmpDir, 'broken.yml'), ': not yaml :::\n', 'utf-8');
    expect(findServiceConfig('x')).toBeNull();
  });
});
