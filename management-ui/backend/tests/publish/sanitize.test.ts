import { describe, it, expect } from 'vitest';
import { buildHostRule, sanitizeString, isSafeServiceName } from '../../src/lib/sanitize.js';

describe('buildHostRule', () => {
  it('строит Host(...) для одного домена', () => {
    expect(buildHostRule('example.com')).toBe('Host(`example.com`)');
  });

  it('объединяет оба base_domain через ||', () => {
    const rule = buildHostRule('my-app.borisovai.ru,my-app.borisovai.tech');
    expect(rule).toContain('Host(`my-app.borisovai.ru`)');
    expect(rule).toContain('Host(`my-app.borisovai.tech`)');
    expect(rule.split('||').length).toBe(2);
  });

  it('игнорирует пустые части', () => {
    const rule = buildHostRule('a.com,,b.com');
    expect(rule).toBe('Host(`a.com`) || Host(`b.com`)');
  });

  it('чистит \\r и пробелы', () => {
    const rule = buildHostRule('a.com\r,b.com');
    expect(rule).toBe('Host(`a.com`) || Host(`b.com`)');
  });

  it('возвращает пусто для невалидного input', () => {
    expect(buildHostRule('')).toBe('');
    expect(buildHostRule(null as unknown as string)).toBe('');
  });
});

describe('sanitizeString', () => {
  it('удаляет \\r и управляющие символы', () => {
    expect(sanitizeString('hello\rworld')).toBe('helloworld');
    expect(sanitizeString('a\x00b\x1Fc')).toBe('abc');
  });
  it('возвращает пустую строку для не-строк', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(123)).toBe('');
  });
});

describe('isSafeServiceName', () => {
  it('принимает безопасные имена', () => {
    expect(isSafeServiceName('grafana')).toBe(true);
    expect(isSafeServiceName('my-app.v2')).toBe(true);
  });
  it('отклоняет path traversal', () => {
    expect(isSafeServiceName('../etc')).toBe(false);
    expect(isSafeServiceName('a/b')).toBe(false);
  });
});
