/*
 * "Signatures" task pane (compose window button). Lists the designs the signed-in person may use, inserts the
 * one they click for this email only, and can make it their default. Runs in the browser runtime, so unlike the
 * event handlers it may show a sign-in popup when silent sign-in fails.
 *
 * Runtime config is prepended by the server to /addin/taskpane.js, exactly like launchevent.js.
 */

import {
  type SigConfig,
  currentItem,
  errMessage,
  fetchSignature,
  fetchWithTimeout,
  getPca,
  getToken,
  naaSupported,
  officeAsync,
  readConfig,
  resolveComposeType,
  resolveFromAddress,
} from "./shared";

interface DesignItem {
  id: string;
  name: string;
  purpose: "person" | "service";
  current: boolean;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
let cfg: SigConfig | null = null;
let token: string | null = null;

function status(text: string, kind: "info" | "error" | "ok" = "info"): void {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function signIn(interactive: boolean): Promise<string> {
  if (!cfg) throw new Error("The add-in isn't configured on the server yet");
  try {
    return await getToken(cfg);
  } catch (silentErr) {
    if (!interactive || !naaSupported()) throw silentErr;
    // Task panes may show UI: fall back to a sign-in popup through the Outlook host (NAA).
    const pca = await getPca(cfg);
    const r = await pca.acquireTokenPopup({ scopes: [cfg.apiScope] });
    return r.accessToken;
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetchWithTimeout(
    `${cfg!.apiBase}${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    },
    8000,
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function insert(design: DesignItem, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    status(`Inserting ${design.name}…`);
    const item = currentItem();
    const type = await resolveComposeType(item);
    const from = item?.itemType === Office.MailboxEnums.ItemType.Message ? await resolveFromAddress(item).catch(() => undefined) : undefined;
    const html = await fetchSignature(cfg!, token!, type, from, design.id);
    if (!html.trim()) {
      status("There’s no signature for this account.", "error");
      return;
    }
    if (typeof item.disableClientSignatureAsync === "function") {
      await officeAsync<void>((cb) => item.disableClientSignatureAsync(cb)).catch(() => undefined);
    }
    await officeAsync<void>((cb) => item.body.setSignatureAsync(html, { coercionType: Office.CoercionType.Html }, cb));
    status(`${design.name} inserted in this email.`, "ok");
  } catch (e) {
    status(`Couldn’t insert it: ${errMessage(e)}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function makeDefault(design: DesignItem): Promise<void> {
  try {
    await api("PUT", "/api/me/design", { design: design.id });
    status(`${design.name} is now your default. New emails start with it.`, "ok");
    await load();
  } catch (e) {
    status(`Couldn’t change your default: ${errMessage(e)}`, "error");
  }
}

function render(designs: DesignItem[], locked: boolean): void {
  const list = $("designs");
  list.innerHTML = "";
  for (const d of designs) {
    const row = document.createElement("div");
    row.className = `design${d.current ? " current" : ""}`;

    const ins = document.createElement("button");
    ins.className = "insert";
    const name = document.createElement("strong");
    name.textContent = d.name; // textContent: names are never parsed as HTML
    const sub = document.createElement("span");
    sub.textContent = d.current ? "Your default · insert in this email" : "Insert in this email";
    ins.append(name, sub);
    ins.addEventListener("click", () => void insert(d, ins));
    row.append(ins);

    if (!locked && !d.current && d.purpose === "person") {
      const def = document.createElement("button");
      def.className = "link";
      def.textContent = "Make default";
      def.addEventListener("click", () => void makeDefault(d));
      row.append(def);
    }
    list.append(row);
  }
  $("locked").hidden = !locked;
}

async function load(): Promise<void> {
  const r = await api<{ locked: boolean; designs: DesignItem[] }>("GET", "/api/me/designs");
  render(r.designs, r.locked);
  if (r.designs.length < 2 && !r.locked) status("Your company has one signature design.", "info");
}

async function start(interactive: boolean): Promise<void> {
  $("signin").hidden = true;
  status("Loading your signatures…");
  try {
    token = await signIn(interactive);
    await load();
    status("");
  } catch (e) {
    status(`Sign-in needed: ${errMessage(e)}`, "error");
    $("signin").hidden = false;
  }
}

Office.onReady(() => {
  cfg = readConfig();
  if (!cfg) {
    status("The signature service isn’t configured yet. Ask IT.", "error");
    return;
  }
  $("signin").addEventListener("click", () => void start(true));
  void start(false);
});
