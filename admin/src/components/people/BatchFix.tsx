import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/hooks';
import { FIELD_LABELS, type UserSummary } from '../../lib/types';
import { Modal } from '../ui';

/** Missing fields an admin can fill in here (email always comes from Entra). */
export const FIXABLE = ['displayName', 'jobTitleLv', 'mobilePhone'] as const;
type Fixable = (typeof FIXABLE)[number];

export const fixableMissing = (u: UserSummary): Fixable[] => (u.excluded ? [] : FIXABLE.filter((f) => u.missing.includes(f)));

const PLACEHOLDER: Record<Fixable, string> = {
  displayName: 'Vārds Uzvārds',
  jobTitleLv: 'e.g. Pārdošanas projektu vadītājs',
  mobilePhone: '+371 2x xxx xxx',
};

/**
 * One person at a time, only their missing fields. Tab moves through the fields; Enter saves and opens the next
 * person once everything shown is filled in.
 */
export function BatchFix({ queue, onClose }: { queue: UserSummary[]; onClose: (changed: number) => void }) {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState(0);
  const [values, setValues] = useState<Partial<Record<Fixable, string>>>({});
  const [noMobile, setNoMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const person = queue[index];
  const fields = person ? fixableMissing(person) : [];

  useEffect(() => {
    setValues({});
    setNoMobile(false);
    // Focus the first field of each new person (the dialog keeps focus otherwise).
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[type=text], input[type=tel]')?.focus());
  }, [index]);

  const filled = (f: Fixable) => (f === 'mobilePhone' && noMobile) || (values[f] ?? '').trim().length > 0;
  const complete = fields.every(filled);
  const next = () => (index + 1 < queue.length ? setIndex(index + 1) : finish(saved));
  const finish = (n: number) => onClose(n);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) {
      // Enter on an unfinished form: jump to the first empty field instead of moving on.
      const empty = fields.find((f) => !filled(f));
      formRef.current?.querySelector<HTMLInputElement>(`[name="${empty}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        if (f === 'mobilePhone' && noMobile) patch.hideMobile = true;
        else patch[f] = values[f]!.trim();
      }
      await api.put(`/api/admin/users/${encodeURIComponent(person.upn)}/overrides`, patch);
      const n = saved + 1;
      setSaved(n);
      if (index + 1 < queue.length) setIndex(index + 1);
      else {
        toast(`Done: ${n} ${n === 1 ? 'person' : 'people'} updated`);
        finish(n);
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!person) return null;
  return (
    <Modal open onClose={() => finish(saved)} title="Fill in missing details">
      <div className="row" style={{ justifyContent: 'space-between', marginTop: -6 }}>
        <span className="small muted">
          {index + 1} of {queue.length}
          {saved > 0 && ` · ${saved} saved`}
        </span>
        <div className="batch-progress" aria-hidden="true">
          <span style={{ width: `${(index / queue.length) * 100}%` }} />
        </div>
      </div>

      <div className="stack tight">
        <strong>{person.displayName ?? person.upn}</strong>
        <span className="small muted">
          {person.upn} · {person.companyName}
        </span>
      </div>

      <form ref={formRef} onSubmit={submit} className="stack" key={person.upn}>
        {fields.map((f) => (
          <div key={f} className="field">
            <label htmlFor={`bf-${f}`}>{FIELD_LABELS[f]}</label>
            <input
              id={`bf-${f}`}
              name={f}
              type={f === 'mobilePhone' ? 'tel' : 'text'}
              autoComplete="off"
              value={values[f] ?? ''}
              disabled={f === 'mobilePhone' && noMobile}
              placeholder={PLACEHOLDER[f]}
              maxLength={f === 'mobilePhone' ? 40 : 160}
              onChange={(e) => setValues({ ...values, [f]: e.target.value })}
            />
            {f === 'mobilePhone' && (
              <label className="check" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={noMobile} onChange={(e) => setNoMobile(e.target.checked)} />
                <span className="small">No mobile phone (leave the line out)</span>
              </label>
            )}
          </div>
        ))}
        <p className="xs muted">
          Tab moves to the next field. Enter saves and opens the next person. Saved as corrections; Entra isn’t changed.
        </p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={() => finish(saved)}>
            Stop
          </button>
          <button type="button" className="btn" onClick={next} disabled={busy}>
            Skip
          </button>
          {/* Not disabled when incomplete: Enter must still reach submit() to jump to the empty field. */}
          <button type="submit" className="btn primary" disabled={busy} aria-disabled={!complete} style={complete ? undefined : { opacity: 0.55 }}>
            {index + 1 < queue.length ? 'Save and next' : 'Save and finish'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
