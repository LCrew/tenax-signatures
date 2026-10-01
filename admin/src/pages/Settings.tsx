import { useState, type ReactNode } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useToast } from '../lib/hooks';
import type { LocalAccount, Settings } from '../lib/types';
import { passwordProblem } from '../lib/password';
import { DirectoryForm } from '../components/DirectoryForm';
import { AddinSteps } from '../components/AddinSteps';
import { ErrorNote, Field, Loading, Modal, PageHead, timeAgo } from '../components/ui';
import { SignatureOptions } from './Setup';

type Tab = 'general' | 'directory' | 'options' | 'accounts' | 'addin';

export function SettingsPage() {
  const { refresh } = useApp();
  const settings = useAsync(() => api.get<Settings>('/api/admin/settings'));
  const [tab, setTab] = useState<Tab>('general');
  const labels: Record<Tab, string> = {
    general: 'Server',
    directory: 'Entra ID connection',
    options: 'Signature options',
    accounts: 'Local accounts',
    addin: 'Outlook add-in',
  };

  if (settings.error) return <ErrorNote error={settings.error} retry={settings.reload} />;
  if (!settings.data) return <Loading />;
  const s = settings.data;
  const reload = async () => {
    await settings.reload();
    await refresh();
  };

  let body: ReactNode;
  if (tab === 'general') body = <General settings={s} onSaved={reload} />;
  if (tab === 'directory') body = <DirectoryForm settings={s} onSaved={reload} />;
  if (tab === 'options') body = <SignatureOptions settings={s} onSaved={reload} />;
  if (tab === 'accounts') body = <Accounts />;
  if (tab === 'addin') body = <AddinSteps settings={s} />;

  return (
    <>
      <PageHead title="Settings" />
      <div className="tabs" role="tablist">
        {(Object.keys(labels) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {labels[t]}
          </button>
        ))}
      </div>
      <div style={{ maxWidth: 820 }}>{body}</div>
    </>
  );
}

function General({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const toast = useToast();
  const { refresh } = useApp();
  const [publicUrl, setPublicUrl] = useState(settings.publicUrl);
  const [origins, setOrigins] = useState(settings.allowedOrigins.join('\n'));
  async function save() {
    try {
      await api.put('/api/admin/settings', {
        publicUrl: publicUrl.replace(/\/+$/, ''),
        allowedOrigins: origins.split(/\s+/).filter(Boolean),
      });
      toast('Server settings saved');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <div className="stack loose">
      <section className="stack">
        <Field label="Public address" hint="Where Outlook loads the add-in and logos from. Changing it means re-uploading the add-in manifest.">
          <input type="url" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
        </Field>
        <Field label="Extra allowed origins" hint="One per line. The public address is always allowed. Only add origins that call the API from a browser.">
          <textarea rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} />
        </Field>
        <div className="row">
          <button className="btn primary" onClick={save}>
            Save server settings
          </button>
        </div>
      </section>
      <section className="stack">
        <h3>Setup wizard</h3>
        <p className="small muted">
          Walk through the first-launch steps again: server address, Entra ID, companies and groups, signature options
          and the Outlook add-in. Your current settings are kept and shown in each step.
        </p>
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            await api.post('/api/admin/setup/restart');
            await refresh();
          }}
        >
          <Wand2 size={14} /> Run setup wizard again
        </button>
      </section>
      <section className="stack">
        <h3>Cached directory data</h3>
        <p className="small muted">
          Profiles are cached for 10 minutes and group memberships for 30. Clear the cache after moving someone between
          groups to see the change immediately.
        </p>
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            await api.post('/api/admin/cache/clear');
            toast('Cache cleared');
          }}
        >
          <RefreshCw size={14} /> Clear cache
        </button>
      </section>
    </div>
  );
}

function Accounts() {
  const { session } = useApp();
  const toast = useToast();
  const list = useAsync(() => api.get<LocalAccount[]>('/api/admin/accounts'));
  const [adding, setAdding] = useState(false);
  const [pwFor, setPwFor] = useState<LocalAccount | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const problem = password ? passwordProblem(password) : null;

  const close = () => {
    setAdding(false);
    setPwFor(null);
    setUsername('');
    setPassword('');
  };

  return (
    <div className="stack">
      <p className="small muted">
        Local accounts sign in with a username and password and always have full access. Keep at least one as a
        break-glass login. Day to day, admins can use their Microsoft account instead.
      </p>
      {list.error && <ErrorNote error={list.error} />}
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Username</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="name">
                  {a.username} {session?.kind === 'local' && session.name === a.username && <span className="tag">You</span>}
                </td>
                <td className="sub">{timeAgo(a.lastLoginAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn ghost sm" onClick={() => setPwFor(a)}>
                    <KeyRound size={14} /> Change password
                  </button>
                  <button
                    className="btn ghost sm danger"
                    aria-label={`Remove ${a.username}`}
                    onClick={async () => {
                      try {
                        await api.del(`/api/admin/accounts/${a.id}`);
                        toast(`${a.username} removed`);
                        await list.reload();
                      } catch (e) {
                        toast((e as Error).message, 'error');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
        <Plus size={14} /> Add local account
      </button>

      <Modal open={adding || !!pwFor} onClose={close} title={pwFor ? `New password for ${pwFor.username}` : 'Add local account'}>
        {adding && (
          <Field label="Username">
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <Field label="Password" hint="At least 12 characters, mixing letters with numbers or symbols" error={problem}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!password || !!problem || (adding && username.length < 3)}
            onClick={async () => {
              try {
                if (pwFor) await api.put(`/api/admin/accounts/${pwFor.id}/password`, { password });
                else await api.post('/api/admin/accounts', { username, password });
                toast(pwFor ? 'Password changed' : 'Account added');
                close();
                await list.reload();
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            {pwFor ? 'Change password' : 'Add account'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
