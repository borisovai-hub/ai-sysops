import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// mock axios и config перед import dns-api
const axiosPost = vi.fn();
vi.mock('axios', () => ({
  default: Object.assign(
    vi.fn(() => Promise.resolve({ status: 200, data: {} })),
    { post: axiosPost, get: vi.fn() },
  ),
}));

let createDnsRecordsForAllDomains: typeof import('../../src/lib/dns-api.js').createDnsRecordsForAllDomains;

beforeEach(async () => {
  axiosPost.mockReset();
  vi.doMock('../../src/config/env.js', () => ({
    getBaseDomains: () => ['borisovai.ru', 'borisovai.tech'],
  }));
  // loadDnsConfig читает реальный файл — замокаем через fs
  vi.doMock('node:fs', async () => {
    const real = await vi.importActual<typeof import('node:fs')>('node:fs');
    return {
      ...real,
      existsSync: (p: string) => p.includes('dns-api/config.json') ? true : real.existsSync(p),
      readFileSync: (p: string, enc?: unknown) =>
        String(p).includes('dns-api/config.json')
          ? '{"provider":"dnsmasq","domain":"borisovai.ru"}'
          : real.readFileSync(p, enc as BufferEncoding),
    };
  });
  const mod = await import('../../src/lib/dns-api.js');
  createDnsRecordsForAllDomains = mod.createDnsRecordsForAllDomains;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../../src/config/env.js');
  vi.doUnmock('node:fs');
});

describe('createDnsRecordsForAllDomains', () => {
  it('создаёт запись для КАЖДОГО base_domain', async () => {
    axiosPost.mockResolvedValue({ status: 200, data: {} });
    const r = await createDnsRecordsForAllDomains('my-app', '1.2.3.4');
    expect(r.done).toBe(true);
    expect(axiosPost).toHaveBeenCalledTimes(2);
    // проверяем что оба домена в вызовах
    const calls = axiosPost.mock.calls.map(c => (c[1] as { domain: string }).domain);
    expect(calls).toContain('borisovai.ru');
    expect(calls).toContain('borisovai.tech');
    // subdomain одинаковый
    for (const call of axiosPost.mock.calls) {
      expect((call[1] as { subdomain: string }).subdomain).toBe('my-app');
      expect((call[1] as { ip: string }).ip).toBe('1.2.3.4');
    }
  });

  it('если оба запроса упали — возвращает error', async () => {
    axiosPost.mockRejectedValue(new Error('network down'));
    const r = await createDnsRecordsForAllDomains('fail', '1.1.1.1');
    expect(r.done).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('если хотя бы один успех — возвращает done:true', async () => {
    axiosPost
      .mockRejectedValueOnce(new Error('ru down'))
      .mockResolvedValueOnce({ status: 200, data: {} });
    const r = await createDnsRecordsForAllDomains('partial', '2.2.2.2');
    expect(r.done).toBe(true);
    expect(r.detail).toContain('borisovai.tech');
    expect(r.detail).not.toContain('borisovai.ru');
  });
});
