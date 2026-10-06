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
  type SigConfig,
  type SignatureType,
  canAttachInline,
  currentItem,
  delay,
  diagnostics,
  errMessage,
  fetchSignature,
  fetchWithTimeout,
  getToken,
  insertSignature,
  officeAsync,
  readConfig,
  resolveComposeType,
  resolveFromAddress,
} from "./shared";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Hard ceiling for a whole handler. After this the event is completed, whatever state it's in. */
const HANDLER_BUDGET_MS = 15000;
/** How long to wait for the telemetry POST before completing the event anyway. */
const TELEMETRY_WAIT_MS = 1000;
const TELEMETRY_MAX_MESSAGE = 500;

/** Context of one handler invocation. `stage` feeds telemetry. */
interface Run {
  eventName: string;
  stage: string;
  composeType: SignatureType | "unknown";
  done: boolean;
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
// Handler core
// ---------------------------------------------------------------------------------------------

async function applySignature(run: Run, cfg: SigConfig, useFrom: boolean): Promise<void> {
  const item = currentItem();
  if (!item) throw new Error("No mailbox item");

  run.stage = "composeType";
  run.composeType = await resolveComposeType(item);

  // The From address picks a shared mailbox's signature (or the sender's own with that mailbox's address).
  // On From changes it's required; on a new message/reply (e.g. replying inside the support@ mailbox) it's best effort.
  let from: string | undefined;
  run.stage = "from";
  if (useFrom) from = await resolveFromAddress(item);
  else if (item.itemType === Office.MailboxEnums.ItemType.Message) from = await resolveFromAddress(item).catch(() => undefined);

  run.stage = "token";
  const token = await getToken(cfg);

  run.stage = "fetch";
  const sig = await fetchSignature(cfg, token, run.composeType, { from, inline: canAttachInline(item) });
  if (!sig.html.trim() || run.done) return; // nothing to insert, or the watchdog already gave up

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
  const { inlineFailed } = await insertSignature(item, sig);
  // The signature went in with linked images instead; worth knowing which clients can't attach.
  if (inlineFailed) void sendTelemetry(cfg, run, `non-fatal: inline images: ${inlineFailed}`);
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
