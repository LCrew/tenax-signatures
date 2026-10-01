import { useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api';

interface Group {
  id: string;
  displayName: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (s: string) => GUID.test(s);
export const isPlaceholderGuid = (s: string) => /^0{8}-0{4}-0{4}-0{4}-/.test(s);

/** Group name + object ID pair, with a lookup against Entra so nobody has to copy GUIDs by hand. */
export function GroupPicker({
  name,
  id,
  onChange,
  label,
}: {
  name: string;
  id: string;
  onChange: (v: { name: string; id: string }) => void;
  label: string;
}) {
  const [results, setResults] = useState<Group[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function find() {
    setSearching(true);
    setErr(null);
    try {
      const r = await api.get<Group[]>(`/api/admin/directory/groups?search=${encodeURIComponent(name)}`);
      setResults(r);
      if (r.length === 0) setErr(`No group named like "${name}" in the directory.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  const idProblem = id && !isGuid(id) ? 'Object IDs look like 8-4-4-4-12 hex characters' : isPlaceholderGuid(id) ? 'Placeholder ID: replace with the real object ID' : null;

  return (
    <div className="stack tight">
      <div className="grid-2">
        <label className="field">
          {label} group name
          <input type="text" value={name} onChange={(e) => onChange({ name: e.target.value, id })} />
        </label>
        <label className="field">
          Object ID
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              type="text"
              className="mono"
              value={id}
              aria-invalid={!!idProblem && !isPlaceholderGuid(id)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              onChange={(e) => onChange({ name, id: e.target.value.trim() })}
            />
            <button type="button" className="btn" onClick={find} disabled={searching || name.trim().length < 2} title="Look up this group name in Entra ID">
              <Search size={14} /> {searching ? 'Finding' : 'Find'}
            </button>
          </div>
          {idProblem && <span className={isPlaceholderGuid(id) ? 'hint' : 'error-text'} style={isPlaceholderGuid(id) ? { color: 'var(--warn)' } : undefined}>{idProblem}</span>}
        </label>
      </div>
      {err && <div className="xs" style={{ color: 'var(--warn)' }}>{err}</div>}
      {results && results.length > 0 && (
        <div className="panel" role="listbox" aria-label="Matching groups">
          {results.map((g) => (
            <button
              key={g.id}
              type="button"
              role="option"
              aria-selected={g.id === id}
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, height: 40 }}
              onClick={() => {
                onChange({ name: g.displayName, id: g.id });
                setResults(null);
              }}
            >
              <span>{g.displayName}</span>
              <span className="mono xs muted">{g.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
