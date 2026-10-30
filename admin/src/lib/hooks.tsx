import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Company, PublicConfig, SessionInfo, TemplateVersion } from './types';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (id === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e as Error);
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The image's height ÷ width once it has loaded; null before that, or when it can't be read. */
export function useImageRatio(src: string | undefined): number | null {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    setRatio(null);
    if (!src) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && img.naturalWidth > 0 && setRatio(img.naturalHeight / img.naturalWidth);
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return ratio;
}

// ───────── Toasts ─────────
type Toast = { id: number; text: string; kind: 'info' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ───────── App state ─────────
export interface AppState {
  config: PublicConfig;
  session: SessionInfo | null;
  refresh: () => Promise<void>;
}
export const AppCtx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppCtx);

/** Companies plus their brand colour (from each company's design settings) for swatches. */
export function useCompanies() {
  const r = useAsync(async () => {
    const rows = await api.get<{ company: Company; meta?: TemplateVersion }[]>('/api/admin/templates');
    return rows.map(({ company, meta }) => {
      let color = '#8a949d';
      try {
        color = JSON.parse(meta?.content ?? '{}').colors?.primary ?? color;
      } catch {
        /* invalid meta is reported in the Designs page */
      }
      return { ...company, color };
    });
  });
  return { companies: r.data ?? [], loading: r.loading, reload: r.reload };
}
