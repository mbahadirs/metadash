import { useT } from '@/lib/i18n';
import type { TypeKey } from '@/lib/types';

export const TYPE_KEYS: TypeKey[] = ['image', 'carousel', 'video', 'reels'];
const ICON: Record<TypeKey, string> = { image: '▢', carousel: '❐', video: '▶', reels: '▶', story: '◐' };

export function typeLabel(key: TypeKey, t: ReturnType<typeof useT>) {
  return t(`type_${key}` as 'type_image');
}

/** Multi-select content type chips shared by Content and Account > Posts. */
export function TypeFilter({ value, onChange, keys = TYPE_KEYS }: { value: TypeKey[]; onChange: (v: TypeKey[]) => void; keys?: TypeKey[] }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('content_type')}>
      <button className={`chip ${!value.length ? 'active' : ''}`} onClick={() => onChange([])}>{t('all')}</button>
      {keys.map((k) => (
        <button key={k} className={`chip ${value.includes(k) ? 'active' : ''}`} onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}>
          <span className="text-[10px] opacity-70">{ICON[k]}</span>{typeLabel(k, t)}
        </button>
      ))}
    </div>
  );
}

export function TypeBadge({ typeKey }: { typeKey: TypeKey }) {
  const t = useT();
  return <span className="badge badge-muted"><span className="text-[10px] opacity-70">{ICON[typeKey]}</span>{typeLabel(typeKey, t)}</span>;
}
