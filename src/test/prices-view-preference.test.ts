import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveViewPreference,
  loadViewPreference,
  clearViewPreference,
  resolveEffectiveView,
  VIEW_PREF_KEY,
} from '@/lib/pricesViewPreference';

beforeEach(() => localStorage.clear());

describe('saveViewPreference + loadViewPreference', () => {
  it('round-trips cards', () => {
    saveViewPreference('cards');
    expect(loadViewPreference()).toBe('cards');
  });
  it('round-trips table', () => {
    saveViewPreference('table');
    expect(loadViewPreference()).toBe('table');
  });
  it('returns null when nothing saved', () => {
    expect(loadViewPreference()).toBeNull();
  });
});

describe('loadViewPreference invalid data', () => {
  it('returns null for invalid JSON', () => {
    localStorage.setItem(VIEW_PREF_KEY, '{bad');
    expect(loadViewPreference()).toBeNull();
  });
  it('returns null for invalid value', () => {
    localStorage.setItem(VIEW_PREF_KEY, JSON.stringify('grid'));
    expect(loadViewPreference()).toBeNull();
  });
  it('returns null for non-string', () => {
    localStorage.setItem(VIEW_PREF_KEY, JSON.stringify(42));
    expect(loadViewPreference()).toBeNull();
  });
});

describe('clearViewPreference', () => {
  it('removes stored data', () => {
    saveViewPreference('cards');
    clearViewPreference();
    expect(loadViewPreference()).toBeNull();
  });
});

describe('resolveEffectiveView', () => {
  it('no preference + mobile => cards', () => {
    expect(resolveEffectiveView(null, true)).toBe('cards');
  });
  it('no preference + desktop => table', () => {
    expect(resolveEffectiveView(null, false)).toBe('table');
  });
  it('saved table overrides mobile', () => {
    expect(resolveEffectiveView('table', true)).toBe('table');
  });
  it('saved cards overrides desktop', () => {
    expect(resolveEffectiveView('cards', false)).toBe('cards');
  });
});

describe('reset clears view preference and falls back', () => {
  beforeEach(() => localStorage.clear());

  it('clear after save restores null', () => {
    saveViewPreference('table');
    clearViewPreference();
    expect(loadViewPreference()).toBeNull();
  });

  it('after clear, resolveEffectiveView uses viewport default (mobile)', () => {
    saveViewPreference('table');
    clearViewPreference();
    expect(resolveEffectiveView(loadViewPreference(), true)).toBe('cards');
  });

  it('after clear, resolveEffectiveView uses viewport default (desktop)', () => {
    saveViewPreference('cards');
    clearViewPreference();
    expect(resolveEffectiveView(loadViewPreference(), false)).toBe('table');
  });
});
