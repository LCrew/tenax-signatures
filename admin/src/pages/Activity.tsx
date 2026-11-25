import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import type { AuditEntry, TelemetryEvent } from '../lib/types';
import { ErrorNote, Loading, PageHead, Segmented } from '../components/ui';
import { dateLocale, msg, t } from '../lib/i18n';

const ACTIONS: Record<string, string> = {
  login: msg('Signed in'),
  'login.failed': msg('Failed sign-in'),
  'overrides.update': msg('Corrected signature details'),
  'overrides.self': msg('Edited own signature'),
  'template.save': msg('Saved a design version'),
  'template.restore': msg('Restored a design version'),
  'template.reload': msg('Reloaded designs from disk'),
  'company.update': msg('Changed a company'),
  'company.create': msg('Added a company'),
  'company.delete': msg('Removed a company'),
  'mailbox.create': msg('Added a shared mailbox'),
  'mailbox.update': msg('Changed a shared mailbox'),
  'mailbox.delete': msg('Removed a shared mailbox'),
  'settings.update': msg('Changed settings'),
  'settings.directory': msg('Changed the Entra connection'),
  'setup.admin.created': msg('Created the first admin'),
  'setup.complete': msg('Finished setup'),
  'setup.restart': msg('Reopened the setup wizard'),
  'user.exclude': msg('Excluded an account from signatures'),
  'design.create': msg('Created a design'),
  'design.update': msg('Changed a design'),
  'design.delete': msg('Removed a design'),
  'design.self': msg('Chose their signature design'),
  'greeting.self': msg('Changed their closing line'),
  'design.image': msg('Saved an image (SVG) design'),
  'font.upload': msg('Uploaded a font'),
  'font.delete': msg('Removed a font'),
  'user.include': msg('Included an account in signatures again'),
  'cache.clear': msg('Cleared the cache'),
  'asset.upload': msg('Uploaded an image'),
  'account.create': msg('Added a local account'),
  'account.password': msg('Changed a password'),
  'account.delete': msg('Removed a local account'),
};

export function ActivityPage() {
  const [view, setView] = useState<'changes' | 'addin'>('changes');
  const audit = useAsync(() => api.get<AuditEntry[]>('/api/admin/audit?limit=300'));
  const telemetry = useAsync(() => api.get<TelemetryEvent[]>('/api/admin/telemetry'));
  const fmt = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <PageHead
        title={t('Activity')}
        lead={t('Every change made in this console, and failures reported by Outlook clients. Add-in errors are reported anonymously by the client, so treat their text as unverified.')}
        actions={
          <Segmented
            label={t('View')}
            value={view}
            onChange={setView}
            options={[
              { value: 'changes', label: t('Changes') },
              { value: 'addin', label: t('Add-in errors') },
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
                  <th>{t('When')}</th>
                  <th>{t('Who')}</th>
                  <th>{t('What')}</th>
                  <th>{t('Target')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((a) => (
                  <tr key={a.id}>
                    <td className="sub" style={{ whiteSpace: 'nowrap' }}>{fmt(a.at)}</td>
                    <td>{a.actor}</td>
                    <td>{a.action === 'login.failed' ? <span className="tag danger">{t(ACTIONS[a.action])}</span> : ACTIONS[a.action] ? t(ACTIONS[a.action]) : a.action}</td>
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
        <div className="panel empty">{t("No failures reported. The add-in reports here when it can't insert a signature.")}</div>
      ) : (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('When')}</th>
                <th>{t('User')}</th>
                <th>{t('Stage')}</th>
                <th>{t('Message')}</th>
                <th>{t('Client')}</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.data.map((ev) => (
                <tr key={ev.id}>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{fmt(ev.at)}</td>
                  <td>{ev.upn ?? <span className="muted">{t('unknown')}</span>}</td>
                  <td>
                    <span className="tag danger">{ev.stage ?? ev.event}</span>
                  </td>
                  <td className="sub">{ev.message}</td>
                  <td className="sub">{[ev.host, ev.platform].filter(Boolean).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
