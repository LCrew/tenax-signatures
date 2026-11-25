import { useSyncExternalStore } from 'react';

/*
  Theme and surface for the console.

  Stored per browser in localStorage ('theme', 'surface'). /theme-init.js applies the same rules before
  first paint (a static file because the CSP allows no inline scripts); keep the two in step.

  <html data-theme> always holds a concrete theme (light | dark | blue | green | neon): "system" is resolved
  here from prefers-color-scheme and followed live. <html data-surface> is glass (default) or solid.
*/

export type ThemePref = 'system' | 'light' | 'dark' | 'blue' | 'green' | 'neon';
export type Surface = 'glass' | 'solid';
export type Appearance = { theme: ThemePref; surface: Surface };

export const THEMES: { value: ThemePref; label: string; note?: string }[] = [
  { value: 'system', label: 'Match system', note: 'Light or dark, as your device is set' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'neon', label: 'Neon' },
];

/** Page colour per theme, also used for the browser's theme-color. */
export const THEME_BG: Record<Exclude<ThemePref, 'system'>, string> = {
  light: '#F1F1ED',
  dark: '#26282C',
  blue: '#EEF2F7',
  green: '#EDF1EC',
  neon: '#14121F',
};

const KNOWN = new Set<string>(THEMES.map((t) => t.value));
const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the choice just isn't remembered */
  }
}

function read(): Appearance {
  const t = readStore('theme');
  return {
    theme: t && KNOWN.has(t) ? (t as ThemePref) : 'system',
    surface: readStore('surface') === 'solid' ? 'solid' : 'glass',
  };
}

let current: Appearance = read();
const listeners = new Set<() => void>();

export function resolveTheme(pref: ThemePref): Exclude<ThemePref, 'system'> {
  if (pref !== 'system') return pref;
  return darkQuery?.matches ? 'dark' : 'light';
}

function apply() {
  const root = document.documentElement;
  const theme = resolveTheme(current.theme);
  root.dataset.theme = theme;
  root.dataset.surface = current.surface;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[theme]);
}

function set(next: Appearance) {
  current = next;
  writeStore('theme', next.theme === 'system' ? null : next.theme);
  writeStore('surface', next.surface === 'glass' ? null : next.surface);
  apply();
  listeners.forEach((l) => l());
}

export const setTheme = (theme: ThemePref) => set({ ...current, theme });
export const setSurface = (surface: Surface) => set({ ...current, surface });

/** Call once at start-up: applies the stored choice and follows the device when the theme is "Match system". */
export function initAppearance() {
  apply();
  darkQuery?.addEventListener('change', () => {
    if (current.theme === 'system') apply();
  });
  // Another tab changed it.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'theme' && e.key !== 'surface' && e.key !== null) return;
    current = read();
    apply();
    listeners.forEach((l) => l());
  });
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/**
 * Runs a DOM update inside a View Transition when the browser has them and the user hasn't asked for
 * reduced motion; phones get their own simpler fade. `update` may return a promise that resolves once
 * the new state is on screen.
 */
export function withViewTransition(update: () => void | Promise<void>, kind: 'tab' | 'state' = 'state') {
  const doc = document as Document & { startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void>; updateCallbackDone: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 800px)').matches) {
    void update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const t = doc.startViewTransition(update);
  t.finished
    .finally(() => {
      if (root.dataset.vt === kind) delete root.dataset.vt;
    })
    .catch(() => {});
  t.updateCallbackDone.catch(() => {});
}
