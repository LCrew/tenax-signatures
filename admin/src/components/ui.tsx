import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export function PageHead({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function CompanyName({ name, color }: { name: string; color?: string }) {
  return (
    <span className="company">
      <span className="swatch" style={{ background: color ?? 'var(--faint)' }} aria-hidden />
      {name}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copied' : label}
    </button>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <div className="codeblock">
      <CopyButton text={children} />
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-label={title}>
      <div className="modal-body">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="loading" aria-busy="true">{what}…</div>;
}

export function ErrorNote({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="callout danger row">
      <span>{error.message}</span>
      {retry && (
        <button className="btn sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('lv-LV', { year: 'numeric', month: 'short', day: 'numeric' });
}
