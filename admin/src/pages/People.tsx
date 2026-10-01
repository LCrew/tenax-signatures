import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useCompanies } from '../lib/hooks';
import { FIELD_LABELS, type UserSummary } from '../lib/types';
import { CompanyName, ErrorNote, Loading, PageHead } from '../components/ui';

type Filter = 'all' | 'issues' | 'overrides' | string;

export function People() {
  const nav = useNavigate();
  const users = useAsync(() => api.get<UserSummary[]>('/api/admin/users'));
  const { companies } = useCompanies();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const colorOf = (k: string) => companies.find((c) => c.key === k)?.color;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => {
      if (needle && !u.upn.includes(needle) && !(u.displayName ?? '').toLowerCase().includes(needle) && !(u.jobTitle ?? '').toLowerCase().includes(needle)) return false;
      if (filter === 'issues') return u.conflict || u.companySource === 'default' || u.missing.length > 0;
      if (filter === 'overrides') return u.overridden.length > 0;
      if (filter !== 'all') return u.company === filter;
      return true;
    });
  }, [users.data, q, filter]);

  return (
    <>
      <PageHead title="People" lead="Everyone with a mailbox licence, the company their signature comes from, and where each value comes from." />
      <div className="row" style={{ marginBottom: 16 }}>
        <label style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <span className="visually-hidden">Search people</span>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--faint)' }} />
          <input type="search" placeholder="Search by name, email or title" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filter">
          <option value="all">Everyone</option>
          <option value="issues">Needs attention</option>
          <option value="overrides">Has corrections</option>
          {companies.map((c) => (
            <option key={c.key} value={c.key}>
              {c.displayName}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {users.data && <span className="small muted">{rows.length} of {users.data.length}</span>}
      </div>
      {users.error && <ErrorNote error={users.error} retry={users.reload} />}
      {users.loading && !users.data ? (
        <Loading what="Loading people" />
      ) : (
        <div className="panel table-wrap">
          {rows.length === 0 ? (
            <div className="empty">{q ? `No one matches "${q}".` : 'No one in this view.'}</div>
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
                        {u.missing.length === 0 && u.overridden.length === 0 && <span className="tag ok">Complete</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
