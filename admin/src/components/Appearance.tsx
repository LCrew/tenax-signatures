import { Check } from 'lucide-react';
import { Modal, Segmented } from './ui';
import { THEMES, setSurface, setTheme, useAppearance, type Surface, type ThemePref } from '../lib/appearance';

/** Two-colour dot previewing a theme: its page colour and its main colour. */
const DOTS: Record<ThemePref, [string, string]> = {
  system: ['#F1F1ED', '#26282C'],
  light: ['#F1F1ED', '#33332F'],
  dark: ['#26282C', '#F2F2EF'],
  blue: ['#EEF2F7', '#A9C4F2'],
  green: ['#EDF1EC', '#A8D5BC'],
  neon: ['#14121F', '#FF7AB8'],
};

export function ThemeDot({ theme }: { theme: ThemePref }) {
  const [a, b] = DOTS[theme];
  return <span className="theme-dot" style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} aria-hidden />;
}

/** Theme (Match system / Light / Dark / pastel / Neon) and surface (Glass / Solid), stored in this browser. */
export function AppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, surface } = useAppearance();
  return (
    <Modal open={open} onClose={onClose} title="Appearance" variant="sheet" size="auto">
      <section className="stack tight">
        <h3 className="section-label" id="appearance-theme">Theme</h3>
        <div className="options" role="radiogroup" aria-labelledby="appearance-theme">
          {THEMES.map((t) => (
            <label key={t.value} className="option">
              <input type="radio" name="appearance-theme" className="visually-hidden" checked={theme === t.value} onChange={() => setTheme(t.value)} />
              <ThemeDot theme={t.value} />
              <span className="option__text">
                <span>{t.label}</span>
                {t.value === 'system' && <small>Recommended</small>}
              </span>
              <Check className="option__check" size={18} aria-hidden />
            </label>
          ))}
        </div>
      </section>
      <section className="stack tight">
        <h3 className="section-label" id="appearance-surface">Surfaces</h3>
        <Segmented<Surface>
          value={surface}
          onChange={setSurface}
          label="Surfaces"
          options={[
            { value: 'glass', label: 'Glass' },
            { value: 'solid', label: 'Solid' },
          ]}
        />
        <p className="xs muted">Glass lets the page’s colour show through panels and bars. Solid keeps every panel plain and opaque.</p>
      </section>
      <p className="xs muted">Saved in this browser only. Signature previews always show the email on white, as recipients see it.</p>
    </Modal>
  );
}
