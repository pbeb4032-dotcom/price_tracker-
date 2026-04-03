/**
 * LocalStorage helpers for persisting the user's preferred view mode (cards vs table)
 * on the /prices page.
 */

export const VIEW_PREF_KEY = 'prices.viewPreference.v1';

export type ViewMode = 'cards' | 'table';

const VALID: ViewMode[] = ['cards', 'table'];

export function saveViewPreference(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_PREF_KEY, JSON.stringify(mode));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export function loadViewPreference(): ViewMode | null {
  try {
    const raw = localStorage.getItem(VIEW_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && VALID.includes(parsed as ViewMode)) {
      return parsed as ViewMode;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearViewPreference(): void {
  try {
    localStorage.removeItem(VIEW_PREF_KEY);
  } catch {
    // silently ignore
  }
}

/**
 * Resolve effective view: saved preference overrides viewport default.
 */
export function resolveEffectiveView(
  saved: ViewMode | null,
  isMobile: boolean,
): ViewMode {
  if (saved) return saved;
  return isMobile ? 'cards' : 'table';
}
