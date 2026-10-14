/*
 * "Signatures" task pane (compose window button). Lists the designs the signed-in person may use, inserts the
 * one they click for this email only, and can make it their default. Runs in the browser runtime, so unlike the
 * event handlers it may show a sign-in popup when silent sign-in fails.
 *
 * Runtime config is prepended by the server to /addin/taskpane.js, exactly like launchevent.js.
 */

import {
  type SigConfig,
  canAttachInline,
  currentItem,
  errMessage,
  fetchSignature,
  fetchWithTimeout,
  getPca,
  getToken,
  insertSignature,
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

/** Shared mailbox with a team signature that this email is sent from. */
interface Mailbox {
  email: string;
  displayName: string;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
let cfg: SigConfig | null = null;
let token: string | null = null;
/** From address the list was loaded for: a shared mailbox's team signature has its own designs. */
let listedFrom: string | undefined;

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
    const from = await currentFrom();
    if (from !== listedFrom) {
      // From changed since the list loaded: show the signatures for the new address before inserting anything.
      await load();
      status(`From is now ${from ?? "your own address"}. Pick a signature for it.`, "info");
      return;
    }
    const sig = await fetchSignature(cfg!, token!, type, { from, design: design.id, inline: canAttachInline(item) });
    if (!sig.html.trim()) {
      status("There’s no signature for this account.", "error");
      return;
    }
    if (typeof item.disableClientSignatureAsync === "function") {
      await officeAsync<void>((cb) => item.disableClientSignatureAsync(cb)).catch(() => undefined);
    }
    await insertSignature(item, sig);
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
    await load();
    status(`${design.name} is now your default. New emails start with it.`, "ok");
  } catch (e) {
    status(`Couldn’t change your default: ${errMessage(e)}`, "error");
  }
}

/** The From address of a message being written; undefined for appointments or when Outlook can't tell. */
async function currentFrom(): Promise<string | undefined> {
  const item = currentItem();
  if (item?.itemType !== Office.MailboxEnums.ItemType.Message) return undefined;
  const from = await resolveFromAddress(item).catch(() => undefined);
  return from?.toLowerCase();
}

function render(designs: DesignItem[], locked: boolean, mailbox?: Mailbox): void {
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
    sub.textContent = !d.current ? "Insert in this email" : mailbox ? "This mailbox’s signature · insert in this email" : "Your default · insert in this email";
    ins.append(name, sub);
    ins.addEventListener("click", () => void insert(d, ins));
    row.append(ins);

    // A team signature's default is set by IT (Shared mailboxes), never here.
    if (!locked && !mailbox && !d.current && d.purpose === "person") {
      const def = document.createElement("button");
      def.className = "link";
      def.textContent = "Make default";
      def.addEventListener("click", () => void makeDefault(d));
      row.append(def);
    }
    list.append(row);
  }
  $("locked").hidden = !locked;
  $("intro").textContent = mailbox
    ? `Sending as ${mailbox.displayName} (${mailbox.email}). Pick a signature for this email.`
    : "Pick a signature for this email. Your default is added automatically to new emails.";
}

async function load(): Promise<void> {
  const from = await currentFrom();
  const r = await api<{ locked: boolean; excluded?: boolean; mailbox?: Mailbox; designs: DesignItem[] }>(
    "GET",
    `/api/me/designs${from ? `?from=${encodeURIComponent(from)}` : ""}`,
  );
  listedFrom = from;
  render(r.designs, r.locked, r.mailbox);
  if (r.excluded) status("There’s no signature for this account. For a shared mailbox, IT can set one up under Shared mailboxes.", "info");
  else if (r.designs.length < 2 && !r.locked) status(r.mailbox ? "This mailbox has one signature design." : "Your company has one signature design.", "info");
  else status("");
}

async function start(interactive: boolean): Promise<void> {
  $("signin").hidden = true;
  status("Loading your signatures…");
  try {
    token = await signIn(interactive);
    await load();
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
