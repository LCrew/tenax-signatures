import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { dateLocale, t } from '../lib/i18n';

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

export function CopyButton({ text, label }: { text: string; label?: string }) {
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
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? t('Copied') : label ?? t('Copy')}
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

/**
 * A dialog on the native <dialog> (focus trap, Escape to close).
 * - variant "window" (default): centred window; the last `.row.end` in it sticks to the bottom as its actions.
 * - variant "sheet": bottom sheet with a fixed head (title + close), scrolling middle and optional fixed `footer`;
 *   closes on the close button, Escape or a tap on the shade. `size="auto"` makes it only as tall as its content.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  variant = 'window',
  footer,
  size,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: 'window' | 'sheet';
  footer?: ReactNode;
  size?: 'auto' | 'full';
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (variant === 'sheet') {
    return (
      <dialog
        ref={ref}
        className={`modal sheet${size === 'auto' ? ' auto' : ''}`}
        onClose={onClose}
        aria-label={title}
        // The dialog itself is only hit outside .sheet__inner, i.e. on the shade.
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      >
        <div className="sheet__inner">
          <header className="sheet__head">
            <h2>{title}</h2>
            <button type="button" className="rb dk sm" aria-label={t('Close')} onClick={() => ref.current?.close()}>
              <X size={20} />
            </button>
          </header>
          <div className="sheet__body">{children}</div>
          {footer && <div className="sheet__foot">{footer}</div>}
        </div>
      </dialog>
    );
  }
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} onClose={onClose} aria-label={title}>
      <div className="modal-body">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** iOS-style switch; the checkbox stays in the page for keyboards and screen readers. */
export function Toggle({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__ui" aria-hidden />
      {children}
    </label>
  );
}

export function Loading({ what }: { what?: string }) {
  return <div className="loading" aria-busy="true">{what ?? t('Loading')}…</div>;
}

export function ErrorNote({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="callout danger row">
      <span>{error.message}</span>
      {retry && (
        <button className="btn sm" onClick={retry}>
          {t('Try again')}
        </button>
      )}
    </div>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return t('never');
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  return new Date(iso).toLocaleDateString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}
