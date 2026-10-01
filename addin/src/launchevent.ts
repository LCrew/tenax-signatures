/*
 * Tenax signature add-in: event-based launch handlers.
 *
 * One file serves two runtimes (brief 7.1/7.2):
 *   - classic Outlook on Windows loads this bundle directly in a JavaScript-only runtime
 *     (manifest JSRuntime.Url). There is no DOM, no ES module loader and Office.onReady()
 *     does NOT run, so handlers are registered with Office.actions.associate() at top level.
 *   - new Outlook, OWA, Mac and mobile load launchevent.html (WebViewRuntime.Url), which pulls
 *     in office.js and then this same bundle.
 *
 * Runtime config is NOT compiled in. The server prepends
 *   globalThis.__SIG_CONFIG__ = {"apiBase":"https://…","clientId":"…","apiScope":"api://…/Signature.Read","tenantId":"…"};
 * to this bundle when serving /addin/launchevent.js. It is read lazily inside the handlers.
 *
 * Authentication order (verified against Microsoft Learn, 2026-09):
 *   1. Nested App Authentication (MSAL.js createNestablePublicClientApplication). NAA is GA in Outlook on
 *      all platforms (NestedAppAuth 1.1: classic Outlook M365 Version 2409+, Mac 16.89+, iOS/Android
 *      4.2433+, web) and Microsoft's "Outlook-Event-SSO-NAA" sample runs it inside event handlers,
 *      including classic Outlook on Windows. Only silent calls are allowed: event handlers can't show UI,
 *      so acquireTokenPopup is never used. Support is detected at runtime via
 *      isSetSupported("NestedAppAuth", "1.1"); it can't be declared in an Outlook manifest.
 *   2. Legacy Office SSO fallback (older builds): OfficeRuntime.auth.getAccessToken, which works in every
 *      build that supports event-based activation plus SSO. Office.auth.getAccessToken only works in
 *      classic Outlook 2111+. Prompts are disabled.
 * Both paths need /.well-known/microsoft-officeaddins-allowed.json listing this script's URL, which the
 * server serves.
 *
 * Invariant: every handler calls event.completed() exactly once on every path (success, error,
 * timeout). Composing must never be blocked.
 */

import {
  createNestablePublicClientApplication,
  type IPublicClientApplication,
} from "@azure/msal-browser";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Timeout for GET /api/signature (brief 7.2: ~4s). */
const FETCH_TIMEOUT_MS = 4000;
/** Per-attempt timeout for token acquisition (NAA or legacy SSO). */
const TOKEN_TIMEOUT_MS = 5000;
/** Hard ceiling for a whole handler. After this the event is completed, whatever state it's in. */
const HANDLER_BUDGET_MS = 15000;
/** How long to wait for the telemetry POST before completing the event anyway. */
const TELEMETRY_WAIT_MS = 1000;
const TELEMETRY_MAX_MESSAGE = 500;

type SignatureType = "newMail" | "reply" | "forward";

interface SigConfig {
  apiBase: string;
  clientId: string;
  apiScope: string;
  tenantId: string;
}

/** Context of one handler invocation. `stage` feeds telemetry. */
interface Run {
  eventName: string;
  stage: string;
  composeType: SignatureType | "unknown";
  done: boolean;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function globalObj(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof self !== "undefined") return self;
  return {};
}

/** Reads and validates the server-injected config. Returns null when it is missing or malformed. */
function readConfig(): SigConfig | null {
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

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects with `label` if `p` hasn't settled within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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
function officeAsync<T>(invoke: (cb: (r: Office.AsyncResult<T>) => void) => void): Promise<T> {
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
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
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

function diagnostics(): { host: string; platform: string } {
  try {
    const d = Office.context.diagnostics;
    return { host: String(d.host ?? "unknown"), platform: String(d.platform ?? "unknown") };
  } catch {
    return { host: "unknown", platform: "unknown" };
  }
}

// ---------------------------------------------------------------------------------------------
// Telemetry (fire and forget; no token; the server rate-limits this endpoint)
// ---------------------------------------------------------------------------------------------

function sendTelemetry(cfg: SigConfig | null, run: Run, message: string): Promise<void> {
  if (!cfg) return Promise.resolve(); // no apiBase means nowhere to send it
  const { host, platform } = diagnostics();
  const body = JSON.stringify({
    event: run.eventName,
    stage: run.stage,
    message: message.slice(0, TELEMETRY_MAX_MESSAGE),
    host,
    platform,
    composeType: run.composeType,
  });
  return fetchWithTimeout(
    `${cfg.apiBase}/api/telemetry`,
    // keepalive lets browser runtimes finish the POST after the runtime is torn down
    { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true },
    TELEMETRY_WAIT_MS * 3,
  ).then(
    () => undefined,
    () => undefined,
  );
}

// ---------------------------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------------------------

let pcaPromise: Promise<IPublicClientApplication> | null = null;

function getPca(cfg: SigConfig): Promise<IPublicClientApplication> {
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

function naaSupported(): boolean {
  try {
    return Office.context.requirements.isSetSupported("NestedAppAuth", "1.1");
  } catch {
    return false;
  }
}

function userHint(): string | undefined {
  try {
    return Office.context.mailbox.userProfile.emailAddress || undefined;
  } catch {
    return undefined;
  }
}

/** NAA: silent only. Event handlers can't show UI, so there is no popup fallback. */
async function naaToken(cfg: SigConfig): Promise<string> {
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
async function legacySsoToken(): Promise<string> {
  const g = globalObj();
  const opts = { allowSignInPrompt: false, allowConsentPrompt: false };
  // OfficeRuntime.auth works in every build with event-based activation plus SSO; Office.auth only in newer builds.
  const auth: { getAccessToken(o: object): Promise<string> } | undefined =
    (g.OfficeRuntime && g.OfficeRuntime.auth) || (typeof Office !== "undefined" ? Office.auth : undefined);
  if (!auth || typeof auth.getAccessToken !== "function") throw new Error("getAccessToken unavailable");
  return auth.getAccessToken(opts);
}

async function getToken(cfg: SigConfig): Promise<string> {
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

function currentItem(): any {
  return Office.context.mailbox.item as any;
}

function isAppointment(item: any): boolean {
  try {
    return item.itemType === Office.MailboxEnums.ItemType.Appointment;
  } catch {
    return false;
  }
}

/** Maps getComposeTypeAsync to the API's type. Appointments (and anything unknown) count as newMail. */
async function resolveComposeType(item: any): Promise<SignatureType> {
  if (isAppointment(item) || typeof item.getComposeTypeAsync !== "function") return "newMail";
  const v = await officeAsync<{ composeType?: string }>((cb) => item.getComposeTypeAsync(cb));
  const t = v && v.composeType;
  return t === "reply" || t === "forward" ? t : "newMail";
}

async function resolveFromAddress(item: any): Promise<string> {
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
async function fetchSignature(cfg: SigConfig, token: string, type: SignatureType, from?: string): Promise<string> {
  let url = `${cfg.apiBase}/api/signature?type=${encodeURIComponent(type)}`;
  if (from) url += `&from=${encodeURIComponent(from)}`;
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

// ---------------------------------------------------------------------------------------------
// Handler core
// ---------------------------------------------------------------------------------------------

async function applySignature(run: Run, cfg: SigConfig, useFrom: boolean): Promise<void> {
  const item = currentItem();
  if (!item) throw new Error("No mailbox item");

  run.stage = "composeType";
  run.composeType = await resolveComposeType(item);

  let from: string | undefined;
  if (useFrom) {
    run.stage = "from";
    from = await resolveFromAddress(item);
  }

  run.stage = "token";
  const token = await getToken(cfg);

  run.stage = "fetch";
  const html = await fetchSignature(cfg, token, run.composeType, from);
  if (!html.trim() || run.done) return; // nothing to insert, or the watchdog already gave up

  // Stop Outlook's own client signature so the user doesn't end up with two. Not fatal on its own.
  run.stage = "disableClientSignature";
  if (typeof item.disableClientSignatureAsync === "function") {
    try {
      await officeAsync<void>((cb) => item.disableClientSignatureAsync(cb));
    } catch (e) {
      void sendTelemetry(cfg, run, `non-fatal: ${errMessage(e)}`);
    }
  }
  if (run.done) return;

  run.stage = "setSignature";
  await officeAsync<void>((cb) => item.body.setSignatureAsync(html, { coercionType: Office.CoercionType.Html }, cb));
  run.stage = "done";
}

/** Shared driver: once-guarded completion, watchdog, telemetry on failure. Never throws. */
function runHandler(eventName: string, event: Office.AddinCommands.Event, useFrom: boolean): void {
  const run: Run = { eventName, stage: "init", composeType: "unknown", done: false };
  let cfg: SigConfig | null = null;

  const complete = (): void => {
    if (run.done) return;
    run.done = true;
    clearTimeout(watchdog);
    try {
      event.completed();
    } catch {
      /* nothing else we can do */
    }
  };

  const fail = (message: string): void => {
    if (run.done) return;
    // Give telemetry a short head start, then complete regardless of whether it got through.
    Promise.race([sendTelemetry(cfg, run, message), delay(TELEMETRY_WAIT_MS)]).then(complete, complete);
  };

  const watchdog = setTimeout(() => fail(`handler budget of ${HANDLER_BUDGET_MS}ms exceeded`), HANDLER_BUDGET_MS);

  try {
    cfg = readConfig();
    if (!cfg) {
      run.stage = "config";
      fail("__SIG_CONFIG__ missing or invalid");
      return;
    }
    applySignature(run, cfg, useFrom).then(complete, (e) => fail(errMessage(e)));
  } catch (e) {
    fail(errMessage(e));
  }
}

// ---------------------------------------------------------------------------------------------
// Handlers (names must match FunctionName in the manifest)
// ---------------------------------------------------------------------------------------------

function onNewMessageComposeHandler(event: Office.AddinCommands.Event): void {
  runHandler("OnNewMessageCompose", event, false);
}

function onNewAppointmentComposeHandler(event: Office.AddinCommands.Event): void {
  runHandler("OnNewAppointmentOrganizer", event, false);
}

/** From changed (shared mailbox / delegate / alias): re-resolve for the new From address. */
function onMessageFromChangedHandler(event: Office.AddinCommands.Event): void {
  runHandler("OnMessageFromChanged", event, true);
}

// Top-level registration. Office.onReady() doesn't run for event handlers in the classic JS runtime.
if (typeof Office !== "undefined") {
  // Browser runtimes (new Outlook, OWA, Mac, mobile) still expect onReady to be wired up.
  try {
    if (typeof Office.onReady === "function") void Office.onReady();
  } catch {
    /* the JS-only runtime may not implement onReady */
  }
  if (Office.actions && typeof Office.actions.associate === "function") {
    Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
    Office.actions.associate("onNewAppointmentComposeHandler", onNewAppointmentComposeHandler);
    Office.actions.associate("onMessageFromChangedHandler", onMessageFromChangedHandler);
  }
}
