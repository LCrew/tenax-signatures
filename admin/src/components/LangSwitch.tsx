import { setLang, t, useLang, type Lang } from '../lib/i18n';

const OPTIONS: { value: Lang; label: string; name: string }[] = [
  { value: 'lv', label: 'LV', name: 'Latviešu' },
  { value: 'en', label: 'EN', name: 'English' },
];

/** Console language: LV / EN. Stored per browser; signatures themselves don't change. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const lang = useLang();
  return (
    <div className={`segmented lang-switch ${className}`} role="group" aria-label={t('Console language')}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" lang={o.value} aria-pressed={lang === o.value} title={o.name} onClick={() => setLang(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
