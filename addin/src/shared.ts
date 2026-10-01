/*
 * Shared by the event handlers (launchevent.ts) and the Signatures task pane (taskpane.ts): runtime config,
 * token acquisition (NAA first, legacy Office SSO fallback), Office helpers and the signature fetch.
 * Bundled into each entry point by esbuild, so the classic Outlook JS-only runtime still gets one IIFE file.
 */

import {
  createNestablePublicClientApplication,
  type IPublicClientApplication,
} from "@azure/msal-browser";

/** Timeout for GET /api/signature (brief 7.2: ~4s). */
export const FETCH_TIMEOUT_MS = 4000;
/** Per-attempt timeout for token acquisition (NAA or legacy SSO). */
export const TOKEN_TIMEOUT_MS = 5000;

export type SignatureType = "newMail" | "reply" | "forward";

export interface SigConfig {
  apiBase: string;
  clientId: string;
  apiScope: string;
  tenantId: string;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function globalObj(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof self !== "undefined") return self;
  return {};
}

/** Reads and validates the server-injected config. Returns null when it is missing or malformed. */
export function readConfig(): SigConfig | null {
  const raw = globalObj().__SIG_CONFIG__;
  if (!raw || typeof raw !== "object") return null;
  const { apiBase, clientId, apiScope, tenantId } = raw as Record<string, unknown>;
  if (
    typeof apiBase !== "string" ||
    !/^https:\/\//i.test(apiBase) ||
    typeof clientId !== "string" ||
    typeof apiScope !== "string" ||
    typeof tenantId !== "string"
  ) {
    return null;
  }
  return { apiBase: apiBase.replace(/\/+$/, ""), clientId, apiScope, tenantId };
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects with `label` if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Wraps an Office callback-style async API as a Promise. */
export function officeAsync<T>(invoke: (cb: (r: Office.AsyncResult<T>) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      invoke((r) => {
        if (r.status === Office.AsyncResultStatus.Succeeded) resolve(r.value);
        else reject(new Error(r.error ? `${r.error.name}: ${r.error.message}` : "Office async call failed"));
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** fetch() with an abort-based timeout. Falls back to a race if AbortController is missing. */
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  if (typeof AbortController === "undefined") {
    return withTimeout(fetch(url, init), ms, "fetch");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`fetch timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function diagnostics(): { host: string; platform: string } {
  try {
    const d = Office.context.diagnostics;
    return { host: String(d.host ?? "unknown"), platform: String(d.platform ?? "unknown") };
  } catch {
    return { host: "unknown", platform: "unknown" };
  }
}

// ---------------------------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------------------------

let pcaPromise: Promise<IPublicClientApplication> | null = null;

export function getPca(cfg: SigConfig): Promise<IPublicClientApplication> {
  if (!pcaPromise) {
    pcaPromise = createNestablePublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      },
    });
    // Don't cache a failed init; the next event retries.
    pcaPromise.catch(() => {
      pcaPromise = null;
    });
  }
  return pcaPromise;
}

export function naaSupported(): boolean {
  try {
    return Office.context.requirements.isSetSupported("NestedAppAuth", "1.1");
  } catch {
    return false;
  }
}

export function userHint(): string | undefined {
  try {
    return Office.context.mailbox.userProfile.emailAddress || undefined;
  } catch {
    return undefined;
  }
}

/** NAA: silent only. Event handlers can't show UI, so there is no popup fallback. */
export async function naaToken(cfg: SigConfig): Promise<string> {
  const pca = await getPca(cfg);
  const scopes = [cfg.apiScope];
  try {
    const r = await pca.acquireTokenSilent({ scopes });
    if (r.accessToken) return r.accessToken;
    throw new Error("acquireTokenSilent returned no access token");
  } catch (silentErr) {
    // ssoSilent asks the host broker again, using the mailbox owner as a hint.
    const r = await pca.ssoSilent({ scopes, loginHint: userHint() }).catch((e: unknown) => {
      throw new Error(`acquireTokenSilent: ${errMessage(silentErr)} | ssoSilent: ${errMessage(e)}`);
    });
    if (!r.accessToken) throw new Error("ssoSilent returned no access token");
    return r.accessToken;
  }
}

/**
 * Legacy Office SSO. The token's audience is the app in <WebApplicationInfo> and its scope is
 * `access_as_user`, so the API must accept that scope as well as Signature.Read (docs/entra-setup.md).
 */
export async function legacySsoToken(): Promise<string> {
  const g = globalObj();
  const opts = { allowSignInPrompt: false, allowConsentPrompt: false };
  // OfficeRuntime.auth works in every build with event-based activation plus SSO; Office.auth only in newer builds.
  const auth: { getAccessToken(o: object): Promise<string> } | undefined =
    (g.OfficeRuntime && g.OfficeRuntime.auth) || (typeof Office !== "undefined" ? Office.auth : undefined);
  if (!auth || typeof auth.getAccessToken !== "function") throw new Error("getAccessToken unavailable");
  return auth.getAccessToken(opts);
}

export async function getToken(cfg: SigConfig): Promise<string> {
  const failures: string[] = [];
  if (naaSupported()) {
    try {
      return await withTimeout(naaToken(cfg), TOKEN_TIMEOUT_MS, "NAA");
    } catch (e) {
      failures.push(`naa: ${errMessage(e)}`);
    }
  } else {
    failures.push("naa: NestedAppAuth 1.1 not supported");
  }
  try {
    return await withTimeout(legacySsoToken(), TOKEN_TIMEOUT_MS, "Office SSO");
  } catch (e) {
    failures.push(`sso: ${errMessage(e)}`);
  }
  throw new Error(failures.join(" | "));
}

// ---------------------------------------------------------------------------------------------
// Mailbox helpers
// ---------------------------------------------------------------------------------------------

export function currentItem(): any {
  return Office.context.mailbox.item as any;
}

export function isAppointment(item: any): boolean {
  try {
    return item.itemType === Office.MailboxEnums.ItemType.Appointment;
  } catch {
    return false;
  }
}

/** Maps getComposeTypeAsync to the API's type. Appointments (and anything unknown) count as newMail. */
export async function resolveComposeType(item: any): Promise<SignatureType> {
  if (isAppointment(item) || typeof item.getComposeTypeAsync !== "function") return "newMail";
  const v = await officeAsync<{ composeType?: string }>((cb) => item.getComposeTypeAsync(cb));
  const t = v && v.composeType;
  return t === "reply" || t === "forward" ? t : "newMail";
}

export async function resolveFromAddress(item: any): Promise<string> {
  if (!item.from || typeof item.from.getAsync !== "function") throw new Error("item.from.getAsync unavailable");
  const v = await officeAsync<Office.EmailAddressDetails>((cb) => item.from.getAsync(cb));
  if (!v || !v.emailAddress) throw new Error("From address is empty");
  return v.emailAddress;
}

// ---------------------------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------------------------

/**
 * Returns the HTML to insert, or "" when the API says there's nothing to insert (204 / empty body).
 * Accepts either text/html or JSON `{ "html": "…" }`.
 */
export async function fetchSignature(cfg: SigConfig, token: string, type: SignatureType, from?: string, design?: string): Promise<string> {
  let url = `${cfg.apiBase}/api/signature?type=${encodeURIComponent(type)}`;
  if (from) url += `&from=${encodeURIComponent(from)}`;
  if (design) url += `&design=${encodeURIComponent(design)}`;
  const res = await fetchWithTimeout(
    url,
    { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "text/html, application/json" }, cache: "no-store" },
    FETCH_TIMEOUT_MS,
  );
  if (res.status === 204) return "";
  if (!res.ok) throw new Error(`GET /api/signature -> HTTP ${res.status}`);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.indexOf("application/json") !== -1) {
    const j = (await res.json()) as { html?: unknown };
    return typeof j.html === "string" ? j.html : "";
  }
  return res.text();
}
