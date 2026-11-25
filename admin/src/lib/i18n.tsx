import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { LV } from './i18n/lv';

/*
  Console language: English (the source text) or Latvian.

  The English text is the key: t('Save version') looks it up in the Latvian dictionary (lib/i18n/lv/*.ts) and falls
  back to the English when there's no entry. Placeholders in braces are filled in after the lookup:
    t('Applies to: {what}', { what })                 -> plain string
    tn(n, '{n} person', '{n} people')                 -> picks the form for n (Latvian: 1, 21, 31… are singular)
    tx('Set it under {link}.', { link: <a>…</a> })    -> React nodes, for text with links or bold parts
  Text kept in constants is marked with msg('…') so `npm run i18n` finds it, and translated where it's shown: t(item.label).
  Never build the key from pieces (`t(a + b)`, template literals): the check can't see it and word order differs.

  The choice is stored per browser ('lang'). Without one, a Latvian browser gets Latvian, anything else English.
*/

export type Lang = 'en' | 'lv';
type Vars = Record<string, string | number>;

const KEY = 'lang';
const listeners = new Set<() => void>();

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'lv' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function detect(): Lang {
  const s = stored();
  if (s) return s;
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return langs.some((l) => /^lv\b/i.test(l ?? '')) ? 'lv' : 'en';
}

let current: Lang = detect();

function apply() {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
apply();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* blocked storage: the choice lasts until the page is reloaded */
  }
  apply();
  listeners.forEach((l) => l());
}

/** Re-renders the caller when the language changes. App uses it, so every page follows. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Marks English text kept in a constant for translation; translate it where it's shown with t(). */
export const msg = (en: string): string => en;

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Translated text, placeholders filled in. */
export function t(en: string, vars?: Vars): string {
  return fill(current === 'lv' ? LV[en] ?? en : en, vars);
}

/** Text for a count: `one` for 1 (Latvian: also 21, 31, … but not 11), `other` otherwise. Both use {n}. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const single = current === 'lv' ? n % 10 === 1 && n % 100 !== 11 : n === 1;
  return t(single ? one : other, { n, ...vars });
}

/** Translated text with React nodes in place of its placeholders (links, bold names, code). */
export function tx(en: string, parts: Record<string, ReactNode>): ReactNode {
  const text = current === 'lv' ? LV[en] ?? en : en;
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : piece}</Fragment>;
  });
}

/** Locale for dates and numbers. Dates stay in the Latvian format (day.month.year) in both languages. */
export const dateLocale = (): string => (current === 'lv' ? 'lv-LV' : 'en-GB');
