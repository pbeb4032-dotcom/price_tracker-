/**
 * Unit tests for social links URL validation/resolution.
 */
import { describe, it, expect } from 'vitest';
import { resolveSocialUrl } from '@/lib/socialLinks';

describe('resolveSocialUrl', () => {
  it('returns valid https URL as-is', () => {
    expect(resolveSocialUrl('https://t.me/channel')).toBe('https://t.me/channel');
  });

  it('returns valid http URL as-is', () => {
    expect(resolveSocialUrl('http://example.com')).toBe('http://example.com');
  });

  it('returns "#" for undefined', () => {
    expect(resolveSocialUrl(undefined)).toBe('#');
  });

  it('returns "#" for empty string', () => {
    expect(resolveSocialUrl('')).toBe('#');
  });

  it('returns "#" for whitespace-only string', () => {
    expect(resolveSocialUrl('   ')).toBe('#');
  });

  it('returns "#" for javascript: scheme', () => {
    expect(resolveSocialUrl('javascript:alert(1)')).toBe('#');
  });

  it('returns "#" for ftp: scheme', () => {
    expect(resolveSocialUrl('ftp://files.example.com')).toBe('#');
  });

  it('returns "#" for data: scheme', () => {
    expect(resolveSocialUrl('data:text/html,<h1>hi</h1>')).toBe('#');
  });

  it('returns "#" for relative path', () => {
    expect(resolveSocialUrl('/some/path')).toBe('#');
  });

  it('returns "#" for malformed URL', () => {
    expect(resolveSocialUrl('not a url at all')).toBe('#');
  });

  it('trims whitespace before validating', () => {
    expect(resolveSocialUrl('  https://t.me/test  ')).toBe('https://t.me/test');
  });
});
