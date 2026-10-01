import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import type { AuditEntry, TelemetryEvent } from '../lib/types';
import { ErrorNote, Loading, PageHead, Segmented } from '../components/ui';

const ACTIONS: Record<string, string> = {
  login: 'Signed in',
  'login.failed': 'Failed sign-in',
  'overrides.update': 'Corrected signature details',
  'overrides.self': 'Edited own signature',
  'template.save': 'Saved a design version',
  'template.restore': 'Restored a design version',
  'template.reload': 'Reloaded designs from disk',
  'company.update': 'Changed a company',
  'company.create': 'Added a company',
  'company.delete': 'Removed a company',
  'mailbox.create': 'Added a shared mailbox',
  'mailbox.update': 'Changed a shared mailbox',
  'mailbox.delete': 'Removed a shared mailbox',
  'settings.update': 'Changed settings',
  'settings.directory': 'Changed the Entra connection',
  'setup.admin.created': 'Created the first admin',
  'setup.complete': 'Finished setup',
  'setup.restart': 'Reopened the setup wizard',
  'user.exclude': 'Excluded an account from signatures',
  'design.create': 'Created a design',
  'design.update': 'Changed a design',
  'design.delete': 'Removed a design',
  'design.self': 'Chose their signature design',
  'user.include': 'Included an account in signatures again',
  'cache.clear': 'Cleared the cache',
  'asset.upload': 'Uploaded an image',
  'account.create': 'Added a local account',
  'account.password': 'Changed a password',
  'account.delete': 'Removed a local account',
};

export function ActivityPage() {
  const [view, setView] = useState<'changes' | 'addin'>('changes');
  const audit = useAsync(() => api.get<AuditEntry[]>('/api/admin/audit?limit=300'));
  const telemetry = useAsync(() => api.get<TelemetryEvent[]>('/api/admin/telemetry'));
  const fmt = (iso: string) => new Date(iso).toLocaleString('lv-LV', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <PageHead
        title="Activity"
        lead="Every change made in this console, and failures reported by Outlook clients. Add-in errors are reported anonymously by the client, so treat their text as unverified."
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'changes', label: 'Changes' },
              { value: 'addin', label: 'Add-in errors' },
            ]}
          />
        }
      />
      {view === 'changes' ? (
        audit.error ? (
          <ErrorNote error={audit.error} />
        ) : !audit.data ? (
          <Loading />
        ) : (
          <div className="panel table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((a) => (
                  <tr key={a.id}>
                    <td className="sub" style={{ whiteSpace: 'nowrap' }}>{fmt(a.at)}</td>
                    <td>{a.actor}</td>
                    <td>{a.action === 'login.failed' ? <span className="tag danger">{ACTIONS[a.action]}</span> : ACTIONS[a.action] ?? a.action}</td>
                    <td className="sub">{a.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : telemetry.error ? (
        <ErrorNote error={telemetry.error} />
      ) : !telemetry.data ? (
        <Loading />
      ) : telemetry.data.length === 0 ? (
        <div className="panel empty">No failures reported. The add-in reports here when it can't insert a signature.</div>
      ) : (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Stage</th>
                <th>Message</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.data.map((t) => (
                <tr key={t.id}>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{fmt(t.at)}</td>
                  <td>{t.upn ?? <span className="muted">unknown</span>}</td>
                  <td>
                    <span className="tag danger">{t.stage ?? t.event}</span>
                  </td>
                  <td className="sub">{t.message}</td>
                  <td className="sub">{[t.host, t.platform].filter(Boolean).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
