import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp, useAsync, useDebounced, useToast } from '../../lib/hooks';
import type { Design, UserSummary } from '../../lib/types';
import { LetterPreview } from '../LetterPreview';
import { Field } from '../ui';

interface TextField {
  id: string;
  lines: { text: string }[];
  family: string;
  weight: number;
  size: number;
}
interface Mapping {
  lines: string[];
  shrinkToFit: boolean;
}
interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Config {
  fields: Record<string, Mapping>;
  crop: Crop;
  width: number;
  link: string;
}
interface Info {
  textFields: TextField[];
  missingFonts: string[];
  placeholders: { value: string; label: string }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Image signature from an SVG template (e.g. Vareno): upload the SVG, map its text to the person's details,
 * and every person gets their own rendered PNG. The same image is used for new messages and replies.
 */
export function ImageDesignEditor({ design, users, onSaved, onLeave }: { design: Design; users: UserSummary[]; onSaved: () => void; onLeave: () => void }) {
  const toast = useToast();
  const { session } = useApp();
  const current = useAsync(() => api.get<{ config: Config | null; version?: number } & Partial<Info>>(`/api/admin/designs/${design.id}/image`), [design.id]);
  const [svg, setSvg] = useState<string | null>(null); // only set after a new upload
  const [info, setInfo] = useState<Info | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [as, setAs] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const focused = useRef<{ id: string; line: number; el: HTMLInputElement } | null>(null);

  useEffect(() => {
    if (!current.data) return;
    setSvg(null);
    setDirty(false);
    setCfg(current.data.config);
    setInfo(current.data.textFields ? { textFields: current.data.textFields, missingFonts: current.data.missingFonts ?? [], placeholders: current.data.placeholders ?? [] } : null);
  }, [current.data]);

  const update = (fn: (c: Config) => Config) => {
    setCfg((c) => (c ? fn(c) : c));
    setDirty(true);
  };

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) return toast('The SVG is larger than 5 MB', 'error');
    try {
      const r = await api.post<{ svg: string; suggested: Config; bytes: { uploaded: number; cleaned: number } } & Info>(`/api/admin/designs/${design.id}/image/analyze`, { svg: await file.text() });
      setSvg(r.svg);
      setInfo({ textFields: r.textFields, missingFonts: r.missingFonts, placeholders: r.placeholders });
      setCfg(r.suggested);
      setDirty(true);
      toast(`SVG read: ${r.textFields.length} text fields found. Check the mapping, then save.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function redetectCrop() {
    if (!svg) return toast('Upload the SVG again to detect the card edges', 'error');
    const r = await api.post<{ suggested: Config }>(`/api/admin/designs/${design.id}/image/analyze`, { svg });
    update((c) => ({ ...c, crop: r.suggested.crop }));
  }

  const debounced = useDebounced(JSON.stringify({ cfg, svg, as }), 450);
  const preview = useAsync(
    () =>
      cfg
        ? api.post<{ dataUrl: string; missingFonts: string[] }>(`/api/admin/designs/${design.id}/image/preview`, { ...cfg, ...(svg ? { svg } : {}), upn: as || undefined })
        : Promise.resolve(null),
    [debounced],
  );
  const html = preview.data && cfg
    ? `${cfg.link ? `<a href="${cfg.link}">` : ''}<img src="${preview.data.dataUrl}" width="${cfg.width}" style="display:block;border:0;width:${cfg.width}px;max-width:100%;height:auto">${cfg.link ? '</a>' : ''}`
    : null;

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await api.post<{ version: number; missingFonts: string[] }>(`/api/admin/designs/${design.id}/image`, { ...cfg, ...(svg ? { svg } : {}), note: note || undefined });
      toast(`Saved (version ${r.version}). New emails use this image.`);
      setNote('');
      onSaved();
      await current.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const insert = (value: string) => {
    const f = focused.current;
    if (!f || !cfg) return;
    const el = f.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + value + el.value.slice(end);
    update((c) => {
      const lines = [...(c.fields[f.id]?.lines ?? [])];
      lines[f.line] = next;
      return { ...c, fields: { ...c.fields, [f.id]: { ...(c.fields[f.id] ?? { shrinkToFit: true }), lines } } };
    });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const missing = preview.data?.missingFonts ?? info?.missingFonts ?? [];

  return (
    <div className="split">
      <section className="panel">
        <div className="panel-head">
          <h3>Image signature</h3>
          <span className="spacer" />
          <label className="btn sm">
            <Upload size={14} /> {cfg ? 'Replace SVG' : 'Upload SVG'}
            <input type="file" accept=".svg,image/svg+xml" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
        <div className="panel-body stack loose">
          {!cfg ? (
            <div className="stack">
              <p className="small muted">
                Upload the SVG of the signature (for example exported from Inkscape or Illustrator, with real text, not
                outlines). Each person gets their own image with their name, title and phone filled in. Email apps don’t
                show SVG, so it’s sent as a sharp PNG.
              </p>
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onLeave}>
                Back to the designer layouts
              </button>
            </div>
          ) : (
            <>
              {missing.length > 0 && (
                <div className="callout warn">
                  Missing fonts: <strong>{missing.join(', ')}</strong>. A similar font is used until {session?.isAdmin ? 'you upload them in Settings › Fonts' : 'IT uploads them (Settings › Fonts)'}.
                </div>
              )}
              <section className="stack">
                <h3>Text in the image</h3>
                <p className="xs muted">
                  Each line can mix fixed text and person details. A line whose details are all empty (for example no mobile)
                  is left out and the lines below move up. Click a line, then a detail below to insert it.
                </p>
                <div className="tags">
                  {(info?.placeholders ?? []).map((p) => (
                    <button key={p.value} type="button" className="tag action" style={{ cursor: 'pointer' }} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.value)} title={p.value}>
                      + {p.label}
                    </button>
                  ))}
                </div>
                {(info?.textFields ?? []).map((t) => {
                  const m = cfg.fields[t.id];
                  return (
                    <div key={t.id} className="wording-row">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong className="small">“{t.lines.map((l) => l.text).join(' / ').slice(0, 60)}”</strong>
                        <span className="xs muted">
                          {t.family || 'default font'} {t.weight} · {round(t.size)}px
                        </span>
                      </div>
                      {m ? (
                        <>
                          {m.lines.map((line, i) => (
                            <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
                              <input
                                type="text"
                                value={line}
                                aria-label={`Line ${i + 1}`}
                                onFocus={(e) => (focused.current = { id: t.id, line: i, el: e.currentTarget })}
                                onChange={(e) => update((c) => ({ ...c, fields: { ...c.fields, [t.id]: { ...m, lines: m.lines.map((x, j) => (j === i ? e.target.value : x)) } } }))}
                              />
                              <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => update((c) => ({ ...c, fields: { ...c.fields, [t.id]: { ...m, lines: m.lines.filter((_, j) => j !== i) } } }))}>
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="row">
                            <button type="button" className="btn ghost sm" onClick={() => update((c) => ({ ...c, fields: { ...c.fields, [t.id]: { ...m, lines: [...m.lines, ''] } } }))}>
                              + Line
                            </button>
                            <label className="check xs">
                              <input type="checkbox" checked={m.shrinkToFit} onChange={(e) => update((c) => ({ ...c, fields: { ...c.fields, [t.id]: { ...m, shrinkToFit: e.target.checked } } }))} />
                              Make smaller if too long to fit
                            </label>
                            <span className="spacer" />
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() =>
                                update((c) => {
                                  const { [t.id]: _drop, ...rest } = c.fields;
                                  return { ...c, fields: rest };
                                })
                              }
                            >
                              Keep the original text
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="row">
                          <span className="xs muted">Shown exactly as in the SVG.</span>
                          <button type="button" className="btn ghost sm" onClick={() => update((c) => ({ ...c, fields: { ...c.fields, [t.id]: { lines: t.lines.map((l) => l.text), shrinkToFit: t.lines.length === 1 } } }))}>
                            Fill with person details
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
              <section className="stack">
                <h3>Image</h3>
                <div className="grid-2">
                  <Field label="Shown width (px)" hint="Rendered at twice this size for sharp screens">
                    <input type="number" min={200} max={800} value={cfg.width} onChange={(e) => update((c) => ({ ...c, width: Number(e.target.value) || 500 }))} />
                  </Field>
                  <Field label="Link when clicked" hint="Full https:// address; empty = not clickable">
                    <input type="url" value={cfg.link} placeholder="https://www.varenogroup.lv" onChange={(e) => update((c) => ({ ...c, link: e.target.value.trim() }))} />
                  </Field>
                </div>
                <details>
                  <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Crop (part of the SVG that’s used)
                  </summary>
                  <div className="ctl-grid" style={{ marginTop: 10 }}>
                    {(['x', 'y', 'width', 'height'] as const).map((k) => (
                      <Field key={k} label={k}>
                        <input type="number" step="0.5" value={round(cfg.crop[k])} onChange={(e) => update((c) => ({ ...c, crop: { ...c.crop, [k]: Number(e.target.value) } }))} />
                      </Field>
                    ))}
                  </div>
                  <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={redetectCrop} disabled={!svg} title={svg ? '' : 'Available right after an upload'}>
                    <RefreshCw size={13} /> Detect the card edges again
                  </button>
                </details>
              </section>
              <p className="xs muted">
                The same image is used for new emails and replies. Contact details are also written into the image’s
                alternative text for screen readers and when images are blocked.
              </p>
            </>
          )}
        </div>
        {cfg && (
          <div className="panel-body row save-bar">
            <input type="text" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: '1 1 200px' }} aria-label="Version note" />
            <button className="btn primary" disabled={(!dirty && !svg) || saving || !!preview.error} onClick={save}>
              {saving ? 'Saving…' : 'Save version'}
            </button>
          </div>
        )}
      </section>

      <div className="sticky stack">
        <Field label="Preview as">
          <select value={as} onChange={(e) => setAs(e.target.value)}>
            <option value="">Sample person (all fields filled)</option>
            {users.map((u) => (
              <option key={u.upn} value={u.upn}>
                {u.displayName ?? u.upn}
              </option>
            ))}
          </select>
        </Field>
        <LetterPreview html={html} error={preview.error?.message} loading={preview.loading} type="newMail" caption="New messages and replies" />
      </div>
    </div>
  );
}
