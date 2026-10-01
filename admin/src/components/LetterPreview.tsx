import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
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

  useEffect(() => setPulse((p) => p + 1), [type]);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff}
    body{padding:4px 20px 20px;font-family:Arial,Helvetica,sans-serif}
    ${dark ? 'html{background:#1f1f1f}body{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}' : ''}
  </style></head><body>${html ?? ''}</body></html>`;

  const measure = () => {
    const d = frame.current?.contentDocument;
    if (d?.body) setHeight(Math.max(60, d.documentElement.scrollHeight));
  };

  const isReply = type !== 'newMail';
  return (
    <div className="desk">
      <div className="desk-controls">
        {onTypeChange ? (
          <Segmented<ComposeType>
            label="Message type"
            value={type}
            onChange={onTypeChange}
            options={[
              { value: 'newMail', label: 'New message' },
              { value: 'reply', label: 'Reply / forward' },
            ]}
          />
        ) : (
          <span className="small muted">{caption}</span>
        )}
        <button type="button" className="btn ghost sm" onClick={() => setDark((d) => !d)} aria-pressed={dark} title="Approximates how Outlook's dark mode recolours the signature">
          {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? 'Light mode' : 'Dark mode check'}
        </button>
      </div>
      <div key={pulse} className={`sheet enter ${dark ? 'dark' : ''}`}>
        <div className="sheet-head">
          <div>
            <b>From</b>&nbsp; {from ? `${from.name} <${from.email}>` : 'Sample person'}
          </div>
          <div>
            <b>Subject</b>&nbsp; {isReply ? 'RE: Piegādes grafiks nākamajai nedēļai' : 'Piedāvājums: siltumizolācijas paneļi'}
          </div>
        </div>
        <div className="sheet-body" aria-hidden>
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
          <iframe
            ref={frame}
            title="Signature preview"
            sandbox="allow-same-origin"
            srcDoc={doc}
            onLoad={measure}
            style={{ height, opacity: loading ? 0.5 : 1 }}
          />
        )}
      </div>
    </div>
  );
}
