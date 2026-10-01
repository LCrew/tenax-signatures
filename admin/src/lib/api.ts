import { getEntraToken } from './auth';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly line?: number) {
    super(message);
  }
}

const MOCK_KEY = 'sig.mockUser';

export function getMockUser(): string | null {
  try {
    return sessionStorage.getItem(MOCK_KEY);
  } catch {
    return null;
  }
}
export function setMockUser(upn: string | null) {
  try {
    if (upn) sessionStorage.setItem(MOCK_KEY, upn);
    else sessionStorage.removeItem(MOCK_KEY);
  } catch {
    /* private mode: mock sign-in just won't persist */
  }
}

async function headers(extra?: HeadersInit): Promise<Headers> {
  const h = new Headers(extra);
  const token = await getEntraToken();
  if (token) h.set('Authorization', `Bearer ${token}`);
  const mock = getMockUser();
  if (!token && mock) h.set('X-Mock-User', mock);
  return h;
}

export async function request<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: await headers() };
  if (body !== undefined) {
    (init.headers as Headers).set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let line: number | undefined;
    if (type.includes('json')) {
      const j = await res.json().catch(() => null);
      if (j?.error) msg = j.error;
      line = j?.line;
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent('sig:unauthorized'));
    throw new ApiError(msg, res.status, line);
  }
  if (res.status === 204) return undefined as T;
  if (type.includes('json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Downloads need auth headers, so they go through fetch + blob rather than a plain link. */
export async function download(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: 'same-origin', headers: await headers() });
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
