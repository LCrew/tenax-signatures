import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Upload, Wand2 } from 'lucide-react';
import { BatchFix, fixableMissing } from '../components/people/BatchFix';
import { ImportCsv } from '../components/people/ImportCsv';
import { api } from '../lib/api';
import { useApp, useAsync, useCompanies } from '../lib/hooks';
import { FIELD_LABELS, SKIP_REASONS, type SkipReason, type UserSummary } from '../lib/types';
import { CompanyName, ErrorNote, Loading, PageHead, Segmented } from '../components/ui';

type Filter = 'all' | 'issues' | 'overrides' | string;
type View = 'active' | 'excluded' | 'skipped';

export function People() {
  const nav = useNavigate();
  const { session } = useApp();
  const { companies } = useCompanies();
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('active');
  const users = useAsync(() => api.get<UserSummary[]>(`/api/admin/users${view === 'active' ? '' : `?view=${view}`}`), [view]);
  const [filter, setFilter] = useState<Filter>('all');
  const colorOf = (k: string) => companies.find((c) => c.key === k)?.color;
  const [batch, setBatch] = useState<UserSummary[] | null>(null);
  const [importing, setImporting] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => {
      if (needle && !u.upn.includes(needle) && !(u.displayName ?? '').toLowerCase().includes(needle) && !(u.jobTitle ?? '').toLowerCase().includes(needle)) return false;
      if (view === 'skipped') return filter === 'all' || u.skipped.includes(filter as SkipReason);
      if (filter === 'issues') return u.conflict || u.companySource === 'default' || u.missing.length > 0;
      if (filter === 'overrides') return u.overridden.length > 0;
      if (filter !== 'all') return u.company === filter;
      return true;
    });
  }, [users.data, q, filter, view]);
  const skippedBy = (r: SkipReason) => (users.data ?? []).filter((u) => u.skipped.includes(r)).length;

  return (
    <>
      <PageHead title="People" lead="Everyone with a mailbox licence, the company their signature comes from, and where each value comes from." />
      <div className="row" style={{ marginBottom: 16 }}>
        <label style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <span className="visually-hidden">Search people</span>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--faint)' }} />
          <input type="search" placeholder="Search by name, email or title" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </label>
        {session?.isAdmin && (
          <Segmented<View>
            label="Which accounts"
            value={view}
            onChange={(v) => {
              setView(v);
              setFilter('all');
            }}
            options={[
              { value: 'active', label: 'In signatures' },
              { value: 'excluded', label: 'Excluded' },
              { value: 'skipped', label: 'Skipped' },
            ]}
          />
        )}
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filter">
          <option value="all">Everyone</option>
          {view === 'skipped' ? (
            (Object.keys(SKIP_REASONS) as SkipReason[]).filter((r) => skippedBy(r) > 0).map((r) => (
              <option key={r} value={r}>
                {SKIP_REASONS[r].label} ({skippedBy(r)})
              </option>
            ))
          ) : (
            <>
              <option value="issues">Needs attention</option>
              <option value="overrides">Has corrections</option>
              {companies.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.displayName}
                </option>
              ))}
            </>
          )}
        </select>
        <span className="spacer" />
        {users.data && <span className="small muted">{rows.length} of {users.data.length}</span>}
        {view === 'active' && (
          <button className="btn" onClick={() => setImporting(true)}>
            <Upload size={15} /> Import CSV
          </button>
        )}
        {view === 'active' && rows.some((u) => fixableMissing(u).length > 0) && (
          <button className="btn primary" onClick={() => setBatch(rows.filter((u) => fixableMissing(u).length > 0))}>
            <Wand2 size={15} /> Fill in missing ({rows.filter((u) => fixableMissing(u).length > 0).length})
          </button>
        )}
      </div>
      {view === 'skipped' && (
        <div className="callout" style={{ marginBottom: 16 }}>
          Microsoft 365 keeps these accounts out of signatures on its own: sign-in is blocked, or there's no licence with an
          active Exchange Online mailbox. Open one to see what to change. Shared mailboxes belong here: their signature is
          set under Shared mailboxes.
        </div>
      )}
      {users.error && <ErrorNote error={users.error} retry={users.reload} />}
      {users.loading && !users.data ? (
        <Loading what="Loading people" />
      ) : (
        <div className="panel table-wrap">
          {rows.length === 0 ? (
            <div className="empty">
              {q ? `No one matches "${q}".` : view === 'excluded' ? 'No accounts are excluded. Exclude service accounts from their person page, or through the exclusion group in Companies and groups.' : view === 'skipped' ? 'Microsoft 365 leaves no accounts out.' : 'No one in this view.'}
              {q && view === 'active' && session?.isAdmin && ' Accounts left out are under Excluded and Skipped.'}
            </div>
          ) : view === 'skipped' ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Why it's left out</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.upn} className="clickable" onClick={() => nav(`/people/${encodeURIComponent(u.upn)}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/people/${encodeURIComponent(u.upn)}`)} tabIndex={0}>
                    <td>
                      <div className="name">{u.displayName ?? u.upn}</div>
                      <div className="sub">{u.upn}</div>
                    </td>
                    <td>
                      <div className="tags">
                        {u.skipped.map((r) => (
                          <span key={r} className="tag warn" title={SKIP_REASONS[r].fix}>
                            {SKIP_REASONS[r].label}
                          </span>
                        ))}
                        {u.sharedMailbox && <span className="tag ok">Shared mailbox</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Company</th>
                  <th>Company from</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.upn} className="clickable" onClick={() => nav(`/people/${encodeURIComponent(u.upn)}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/people/${encodeURIComponent(u.upn)}`)} tabIndex={0}>
                    <td>
                      <div className="name">{u.displayName ?? u.upn}</div>
                      <div className="sub">{u.jobTitle ?? u.upn}</div>
                    </td>
                    <td>
                      <CompanyName name={u.companyName} color={colorOf(u.company)} />
                    </td>
                    <td>
                      {u.companySource === 'group' && !u.conflict && <span className="tag">Group</span>}
                      {u.conflict && <span className="tag warn">{u.candidates.length} groups</span>}
                      {u.companySource === 'override' && <span className="tag action">Set by admin</span>}
                      {u.companySource === 'default' && <span className="tag warn">Default</span>}
                    </td>
                    <td>
                      <div className="tags">
                        {u.missing.map((m) => (
                          <span key={m} className="tag danger">No {FIELD_LABELS[m]?.toLowerCase() ?? m}</span>
                        ))}
                        {u.overridden.length > 0 && <span className="tag action">{u.overridden.length} corrected</span>}
                        {u.design && u.design.source !== 'default' && (
                          <span className={`tag ${u.design.purpose === 'service' ? '' : 'action'}`} title={u.designLocked ? 'Locked by an admin' : undefined}>
                            {u.design.name}
                            {u.designLocked ? ' 🔒' : ''}
                          </span>
                        )}
                        {u.excluded && <span className="tag">{u.excluded.by === 'group' ? 'Excluded by group' : `Excluded${u.excluded.reason ? `: ${u.excluded.reason}` : ''}`}</span>}
                        {!u.excluded && u.missing.length === 0 && u.overridden.length === 0 && <span className="tag ok">Complete</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {importing && (
        <ImportCsv
          onClose={(changed) => {
            setImporting(false);
            if (changed > 0) void users.reload();
          }}
        />
      )}
      {batch && (
        <BatchFix
          queue={batch}
          onClose={(changed) => {
            setBatch(null);
            if (changed > 0) void users.reload();
          }}
        />
      )}
    </>
  );
}
