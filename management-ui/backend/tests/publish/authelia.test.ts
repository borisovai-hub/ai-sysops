import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'yaml';

let tmpDir: string;
let configPath: string;
let ensureAccessControl: typeof import('../../src/lib/authelia.js').ensureAccessControl;
let removeAccessControl: typeof import('../../src/lib/authelia.js').removeAccessControl;

const INITIAL_CONFIG = {
  access_control: {
    default_policy: 'deny',
    rules: [
      { domain: 'auth.borisovai.ru', policy: 'bypass' },
    ],
  },
};

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'authelia-test-'));
  configPath = join(tmpDir, 'configuration.yml');
  writeFileSync(configPath, yaml.stringify(INITIAL_CONFIG), 'utf-8');

  vi.doMock('@management-ui/shared', async () => {
    const real = await vi.importActual<typeof import('@management-ui/shared')>('@management-ui/shared');
    return {
      ...real,
      PATHS: { ...real.PATHS, AUTHELIA_CONFIG: configPath },
    };
  });
  vi.doMock('../../src/config/env.js', () => ({
    getAutheliaUsersPath: () => join(tmpDir, 'users_database.yml'),
    getAutheliaMailboxesPath: () => join(tmpDir, 'mailboxes.json'),
    isAutheliaGitOps: () => true, // отключаем chown/restart
  }));
  vi.doMock('../../src/lib/exec.js', () => ({
    execCommandSafe: () => ({ success: true, stdout: '', error: '' }),
    execFileSafe: () => ({ success: true, stdout: '', error: '' }),
  }));

  const mod = await import('../../src/lib/authelia.js');
  ensureAccessControl = mod.ensureAccessControl;
  removeAccessControl = mod.removeAccessControl;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@management-ui/shared');
  vi.doUnmock('../../src/config/env.js');
  vi.doUnmock('../../src/lib/exec.js');
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensureAccessControl', () => {
  it('добавляет новые домены в access_control', () => {
    const r = ensureAccessControl(['grafana.dev.borisovai.ru', 'grafana.dev.borisovai.tech'], 'two_factor');
    expect(r.added).toEqual(['grafana.dev.borisovai.ru', 'grafana.dev.borisovai.tech']);
    expect(r.alreadyPresent).toEqual([]);

    const written = yaml.parse(readFileSync(configPath, 'utf-8'));
    expect(written.access_control.rules).toHaveLength(3); // 1 initial + 2 added
    const domains = written.access_control.rules.map((r: { domain: string }) => r.domain);
    expect(domains).toContain('grafana.dev.borisovai.ru');
    expect(domains).toContain('grafana.dev.borisovai.tech');
  });

  it('идемпотентно: повторный вызов не дублирует правила', () => {
    ensureAccessControl(['grafana.dev.borisovai.ru'], 'two_factor');
    const r2 = ensureAccessControl(['grafana.dev.borisovai.ru'], 'two_factor');
    expect(r2.added).toEqual([]);
    expect(r2.alreadyPresent).toEqual(['grafana.dev.borisovai.ru']);

    const written = yaml.parse(readFileSync(configPath, 'utf-8'));
    const occurrences = written.access_control.rules.filter(
      (r: { domain: string }) => r.domain === 'grafana.dev.borisovai.ru',
    );
    expect(occurrences).toHaveLength(1);
  });

  it('не перезаписывает правила с другой policy как матч', () => {
    // Подмешиваем правило с bypass, запрашиваем тот же домен с two_factor.
    writeFileSync(configPath, yaml.stringify({
      access_control: {
        default_policy: 'deny',
        rules: [{ domain: 'test.borisovai.ru', policy: 'bypass' }],
      },
    }), 'utf-8');
    const r = ensureAccessControl(['test.borisovai.ru'], 'two_factor');
    expect(r.added).toEqual(['test.borisovai.ru']);
    const written = yaml.parse(readFileSync(configPath, 'utf-8'));
    expect(written.access_control.rules).toHaveLength(2);
  });
});

describe('removeAccessControl', () => {
  it('удаляет только заданные домены', () => {
    ensureAccessControl(['a.tld', 'b.tld'], 'two_factor');
    const r = removeAccessControl(['a.tld']);
    expect(r.removed).toContain('a.tld');
    const written = yaml.parse(readFileSync(configPath, 'utf-8'));
    const domains = written.access_control.rules.map((r: { domain: string | string[] }) =>
      Array.isArray(r.domain) ? r.domain[0] : r.domain);
    expect(domains).toContain('b.tld');
    expect(domains).not.toContain('a.tld');
  });

  it('no-op если доменов нет', () => {
    const r = removeAccessControl(['nonexistent.tld']);
    expect(r.removed).toEqual([]);
  });
});
