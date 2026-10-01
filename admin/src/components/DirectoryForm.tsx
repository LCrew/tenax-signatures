import { useState } from 'react';
import { CheckCircle2, Database, KeyRound, Upload } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useToast } from '../lib/hooks';
import type { Settings } from '../lib/types';
import { CodeBlock, Field } from './ui';
import { isGuid } from './GroupPicker';

export interface ScriptOutput {
  tenantId?: string;
  clientId?: string;
  appIdUri?: string;
  groups?: Record<string, string>;
}

/** Parses the JSON summary printed by scripts/entra-setup.ps1. */
export function parseScriptOutput(text: string): ScriptOutput | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function readFile(f: File) {
  return f.text();
}

export function DirectoryForm({ settings, onSaved, compact = false }: { settings: Settings; onSaved: (s: Settings, script?: ScriptOutput) => void; compact?: boolean }) {
  const toast = useToast();
  const host = (() => {
    try {
      return new URL(settings.publicUrl).host;
    } catch {
      return 'sig.tenaxgrupa.lv';
    }
  })();
  const [mode, setMode] = useState<Settings['directoryMode']>(settings.directoryMode);
  const [tenantId, setTenantId] = useState(settings.tenantId);
  const [clientId, setClientId] = useState(settings.clientId);
  const [appIdUri, setAppIdUri] = useState(settings.appIdUri);
  const [credType, setCredType] = useState<'certificate' | 'secret'>(settings.credentialType === 'secret' ? 'secret' : 'certificate');
  const [pem, setPem] = useState('');
  const [secret, setSecret] = useState('');
  const [paste, setPaste] = useState('');
  const [script, setScript] = useState<ScriptOutput | undefined>();
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);

  const effectiveUri = appIdUri || (clientId ? `api://${host}/${clientId}` : '');
  const body = () => ({
    directoryMode: mode,
    ...(mode === 'graph' && {
      tenantId,
      clientId,
      appIdUri: effectiveUri,
      credentialType: credType,
      ...(credType === 'certificate' && pem ? { certificatePem: pem } : {}),
      ...(credType === 'secret' && secret ? { clientSecret: secret } : {}),
    }),
  });

  const hasCred = credType === 'certificate' ? !!pem || settings.hasCertificate : !!secret || settings.hasClientSecret;
  const idsOk = isGuid(tenantId) && isGuid(clientId);
  const canSubmit = mode === 'mock' || (idsOk && hasCred);

  function applyPaste(text: string) {
    setPaste(text);
    const out = parseScriptOutput(text);
    if (!out) return;
    if (out.tenantId) setTenantId(out.tenantId);
    if (out.clientId) setClientId(out.clientId);
    if (out.appIdUri) setAppIdUri(out.appIdUri);
    setScript(out);
    toast('Filled in the IDs from the script output');
  }

  async function runTest() {
    setBusy('test');
    setTest(null);
    try {
      setTest(await api.post('/api/admin/settings/directory/test', body()));
    } catch (e) {
      setTest({ ok: false, detail: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    try {
      const s = await api.put<Settings>('/api/admin/settings/directory', body());
      toast('Directory connection saved');
      setPem('');
      setSecret('');
      onSaved(s, script);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack loose">
      {settings.mockForcedByEnv && (
        <div className="callout warn">
          The container runs with <code>MOCK_GRAPH=true</code>, so demo data is used whatever you pick here. Remove it
          from the environment to use Entra ID.
        </div>
      )}
      <div className="grid-2" role="radiogroup" aria-label="Where people come from">
        <ModeCard active={mode === 'graph'} onClick={() => setMode('graph')} icon={<KeyRound size={18} />} title="Microsoft Entra ID" text="Read real users and groups from your tenant through Microsoft Graph (read-only)." />
        <ModeCard active={mode === 'mock'} onClick={() => setMode('mock')} icon={<Database size={18} />} title="Demo data" text="Eight sample people from fixtures/users.json. Good for trying designs before connecting the tenant." />
      </div>

      {mode === 'graph' && (
        <>
          {!compact && (
            <section className="stack">
              <h3>Register the app in Entra ID</h3>
              <ol className="instructions">
                <li>
                  <div className="stack tight">
                    <span>
                      Create a certificate on your admin machine. The private key stays with you until you upload it
                      below.
                    </span>
                    <CodeBlock>{`openssl req -x509 -newkey rsa:2048 -sha256 -days 730 -nodes \\
  -subj "/CN=Tenax Signature API" \\
  -keyout tenax-signature-api.key.pem -out tenax-signature-api.crt.pem
openssl x509 -in tenax-signature-api.crt.pem -outform der -out tenax-signature-api.cer`}</CodeBlock>
                  </div>
                </li>
                <li>
                  <div className="stack tight">
                    <span>
                      As a Global Administrator, run the setup script from the repository in PowerShell 7. It creates the
                      "Tenax Signature API" registration, grants read-only Graph permissions and prints the IDs. It never
                      touches users or mailboxes.
                    </span>
                    <CodeBlock>{`Install-Module Microsoft.Graph -Scope CurrentUser
./scripts/entra-setup.ps1 -TenantId TenaxMID.onmicrosoft.com -PublicHost ${host} -CertPath ./tenax-signature-api.cer`}</CodeBlock>
                    <span className="xs muted">
                      Prefer clicking through the portal? Follow docs/entra-setup.md; it covers the same steps by hand.
                    </span>
                  </div>
                </li>
                <li>
                  <div className="stack tight" style={{ width: '100%' }}>
                    <span>Paste everything the script printed. The IDs below fill in automatically.</span>
                    <textarea rows={4} value={paste} onChange={(e) => applyPaste(e.target.value)} placeholder='{ "tenantId": "…", "clientId": "…", … }' aria-label="Script output" />
                  </div>
                </li>
              </ol>
            </section>
          )}

          <section className="stack">
            <div className="grid-2">
              <Field label="Directory (tenant) ID" error={tenantId && !isGuid(tenantId) ? 'Use the GUID, not the domain name' : null}>
                <input type="text" className="mono" value={tenantId} onChange={(e) => setTenantId(e.target.value.trim())} />
              </Field>
              <Field label="Application (client) ID" error={clientId && !isGuid(clientId) ? 'Should be a GUID' : null}>
                <input type="text" className="mono" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} />
              </Field>
            </div>
            <Field label="Application ID URI" hint={`Leave empty to use ${clientId ? `api://${host}/${clientId}` : `api://${host}/<client ID>`}`}>
              <input type="text" className="mono" value={appIdUri} onChange={(e) => setAppIdUri(e.target.value.trim())} placeholder={clientId ? `api://${host}/${clientId}` : ''} />
            </Field>
          </section>

          <section className="stack">
            <h3>App credential</h3>
            <div className="row">
              <label className="check">
                <input type="radio" name="cred" checked={credType === 'certificate'} onChange={() => setCredType('certificate')} />
                <span>
                  <strong>Certificate</strong> <span className="muted">(recommended for production)</span>
                </span>
              </label>
              <label className="check">
                <input type="radio" name="cred" checked={credType === 'secret'} onChange={() => setCredType('secret')} />
                <span>
                  <strong>Client secret</strong> <span className="muted">(testing only)</span>
                </span>
              </label>
            </div>
            {credType === 'certificate' ? (
              <div className="stack tight">
                {settings.hasCertificate && !pem && (
                  <div className="callout ok row">
                    <CheckCircle2 size={16} /> A certificate is stored
                    {settings.certificateExpires && <> (expires {new Date(settings.certificateExpires).toLocaleDateString('lv-LV')})</>}. Upload a new one only to rotate it.
                  </div>
                )}
                <Field label="Certificate and private key (PEM)" hint="Select both .crt.pem and .key.pem, or paste them together. Stored encrypted on the server.">
                  <textarea rows={5} value={pem} onChange={(e) => setPem(e.target.value)} placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----BEGIN PRIVATE KEY-----\n…'} />
                </Field>
                <label className="btn" style={{ alignSelf: 'flex-start' }}>
                  <Upload size={14} /> Choose PEM files
                  <input
                    type="file"
                    accept=".pem,.crt,.key,.txt"
                    multiple
                    className="visually-hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      const texts = await Promise.all(files.map(readFile));
                      setPem(texts.join('\n'));
                    }}
                  />
                </label>
              </div>
            ) : (
              <Field label="Client secret value" hint={settings.hasClientSecret ? 'A secret is stored. Enter a new one only to replace it.' : 'Secrets expire and are easy to leak. Switch to a certificate before going live.'}>
                <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </Field>
            )}
          </section>
        </>
      )}

      {test && (
        <div className={`callout ${test.ok ? 'ok' : 'danger'}`} role="status">
          {test.ok ? 'Connection works. ' : "Couldn't connect. "}
          {test.detail}
        </div>
      )}

      <div className="row">
        {mode === 'graph' && (
          <button type="button" className="btn" onClick={runTest} disabled={!canSubmit || busy !== null}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
        )}
        <button type="button" className="btn primary" onClick={save} disabled={!canSubmit || busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save connection'}
        </button>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="panel"
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: 16,
        borderRadius: 10,
        background: 'var(--surface)',
        border: `1px solid ${active ? 'var(--action)' : 'var(--line)'}`,
        boxShadow: active ? 'inset 0 0 0 1px var(--action)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span className="row" style={{ fontWeight: 700, color: active ? 'var(--action)' : 'var(--ink)' }}>
        {icon} {title}
      </span>
      <span className="small muted">{text}</span>
    </button>
  );
}
