import { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { t } from '../lib/i18n';
import { Segmented } from './ui';
import type { ComposeType } from '../lib/types';

interface Props {
  html: string | null;
  error?: string | null;
  loading?: boolean;
  from?: { name: string; email: string };
  type: ComposeType;
  onTypeChange?: (t: ComposeType) => void;
  caption?: string;
}

/**
 * The signature shown where it lives: at the bottom of a message. Rendered in a sandboxed iframe
 * (no scripts) so template CSS can't leak into the console and vice versa.
 */
export function LetterPreview({ html, error, loading, from, type, onTypeChange, caption }: Props) {
  const [dark, setDark] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [pulse, setPulse] = useState(0);
  // Narrow columns: a signature wider than the column (fixed-width tables, banners) is laid out at its own
  // width and scaled down to fit, instead of being cut off. `needed` = that width, 0 = it fits.
  const [avail, setAvail] = useState(0);
  const [needed, setNeeded] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const mailRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(([entry]) => setAvail(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  const scale = avail > 0 && needed > avail ? avail / needed : 1;

  useEffect(() => setPulse((p) => p + 1), [type]);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff}
    body{padding:4px 20px 20px;font-family:Arial,Helvetica,sans-serif}
    ${dark ? 'html{background:#1f1f1f}body{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}' : ''}
  </style></head><body>${html ?? ''}</body></html>`;

  const measure = () => {
    const d = frame.current?.contentDocument;
    if (!d?.body) return;
    const root = d.documentElement;
    setHeight(Math.max(60, root.scrollHeight));
    if (root.scrollWidth > root.clientWidth + 1) setNeeded(root.scrollWidth);
  };
  // New content: measure it again at the column's width (onLoad follows).
  useEffect(() => setNeeded(0), [doc]);
  // Column resized while the signature fitted: check it still does.
  useEffect(() => {
    if (needed === 0) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail]);

  const isReply = type !== 'newMail';
  return (
    <div className="desk">
      <div className="desk-controls">
        {onTypeChange ? (
          <Segmented<ComposeType>
            label={t('Message type')}
            value={type}
            onChange={onTypeChange}
            options={[
              { value: 'newMail', label: t('New message') },
              { value: 'reply', label: t('Reply / forward') },
            ]}
          />
        ) : (
          <span className="small muted">{caption}</span>
        )}
        <button type="button" className="btn ghost sm" onClick={() => setDark((d) => !d)} aria-pressed={dark} title={t("Approximates how Outlook's dark mode recolours the signature")}>
          {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? t('Light mode') : t('Dark mode check')}
        </button>
      </div>
      <div key={pulse} ref={mailRef} className={`mail enter${dark ? ' dark' : ''}`}>
        <div className="mail-head">
          <div>
            <b>{t('From')}</b>&nbsp; {from ? `${from.name} <${from.email}>` : t('Sample person')}
          </div>
          <div>
            <b>{t('Subject')}</b>&nbsp; {isReply ? 'RE: Piegādes grafiks nākamajai nedēļai' : 'Piedāvājums: siltumizolācijas paneļi'}
          </div>
        </div>
        <div className="mail-body" aria-hidden>
          <div className="prose-line" style={{ width: '92%' }} />
          <div className="prose-line" style={{ width: '78%' }} />
          {!isReply && <div className="prose-line" style={{ width: '85%' }} />}
          <div className="prose-line" style={{ width: '30%', marginTop: 16 }} />
        </div>
        {error ? (
          <div style={{ padding: '8px 20px 20px' }}>
            <div className="callout danger">{error}</div>
          </div>
        ) : (
          <div className="mail-frame" style={{ height: Math.ceil(height * scale) }}>
            <iframe
              ref={frame}
              title={t('Signature preview')}
              sandbox="allow-same-origin"
              srcDoc={doc}
              onLoad={measure}
              style={{
                height,
                opacity: loading ? 0.5 : 1,
                ...(scale < 1 ? { width: needed, transform: `scale(${scale})`, transformOrigin: '0 0' } : {}),
              }}
            />
          </div>
        )}
        {!error && scale < 1 && <div className="mail-scale">{t('Shown at {pct}% to fit. Widen the window for full size.', { pct: Math.round(scale * 100) })}</div>}
      </div>
    </div>
  );
}
