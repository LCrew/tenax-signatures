import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api, download } from '../../lib/api';
import { useToast } from '../../lib/hooks';
import { FIELD_LABELS } from '../../lib/types';
import { Modal } from '../ui';

interface ImportRow {
  line: number;
  upn: string;
  name: string | null;
  status: 'update' | 'unchanged' | 'error';
  changes: Record<string, string | boolean>;
  notes: string[];
  error?: string;
}
interface ImportResult {
  dryRun: boolean;
  rows: ImportRow[];
  ignoredColumns: string[];
  totals: { update: number; unchanged: number; error: number };
}

/** Excel saves "CSV" in the Windows code page unless told otherwise; Latvian Windows uses 1257. */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1257').decode(bytes);
  }
}

const changeLabel = (k: string, v: string | boolean) => (k === 'hideMobile' ? 'No mobile' : `${FIELD_LABELS[k] ?? k}: ${v}`);

/**
 * Download the list of gaps, let someone (or an agent, see docs/csv-import.md) fill it in, upload it back.
 * The file is always checked first; nothing is saved until "Import".
 */
export function ImportCsv({ onClose }: { onClose: (changed: number) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(f: File) {
    setBusy(true);
    setResult(null);
    try {
      const csv = await readText(f);
      setFile({ name: f.name, csv });
      setResult(await api.post<ImportResult>('/api/admin/import/missing', { csv, dryRun: true }));
    } catch (err) {
      setFile(null);
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.post<ImportResult>('/api/admin/import/missing', { csv: file.csv, dryRun: false });
      toast(`Imported: ${r.totals.update} ${r.totals.update === 1 ? 'person' : 'people'} updated`);
      onClose(r.totals.update);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const shown = result?.rows.filter((r) => r.status !== 'unchanged' || r.notes.length > 0) ?? [];

  return (
    <Modal open onClose={() => onClose(0)} title="Import missing details">
      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          Download the list of people with missing details. Blank cells are what’s missing.
        </li>
        <li>Fill in the blanks (by hand, or give the file and docs/csv-import.md to an agent).</li>
        <li>Upload it here. You see what would change before anything is saved.</li>
      </ol>
      <div className="row">
        <button className="btn" onClick={() => download('/api/admin/missing.csv', 'signature-missing.csv').catch((e) => toast(e.message, 'error'))}>
          <Download size={14} /> Download missing list
        </button>
        <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> {file ? 'Choose another file' : 'Choose CSV file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void check(f);
          }}
        />
      </div>

      {busy && !result && <div className="small muted">Checking…</div>}
      {result && file && (
        <div className="stack tight">
          <div className="small">
            <strong>{file.name}</strong>: {result.totals.update} to update · {result.totals.unchanged} unchanged
            {result.totals.error > 0 && <span style={{ color: 'var(--danger)' }}> · {result.totals.error} with problems (skipped)</span>}
          </div>
          {result.ignoredColumns.length > 0 && <div className="xs muted">Not imported (for reference only): {result.ignoredColumns.join(', ')}</div>}
          {shown.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
              <table className="data">
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line}>
                      <td className="xs muted" style={{ verticalAlign: 'top' }}>
                        {r.line}
                      </td>
                      <td>
                        <div className="name">{r.name ?? (r.upn || '(no upn)')}</div>
                        <div className="tags" style={{ marginTop: 4 }}>
                          {r.status === 'error' && <span className="tag danger">{r.error}</span>}
                          {Object.entries(r.changes).map(([k, v]) => (
                            <span key={k} className="tag action">
                              {changeLabel(k, v)}
                            </span>
                          ))}
                          {r.notes.map((n) => (
                            <span key={n} className="tag warn">
                              {n}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="xs muted">Only missing details are filled in, saved as corrections. Values that are already set are kept; Entra isn’t changed.</p>
        </div>
      )}

      <div className="row end">
        <button type="button" className="btn ghost" onClick={() => onClose(0)}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy || !result || result.totals.update === 0} onClick={run}>
          Import {result?.totals.update ? `${result.totals.update} ${result.totals.update === 1 ? 'person' : 'people'}` : ''}
        </button>
      </div>
    </Modal>
  );
}
