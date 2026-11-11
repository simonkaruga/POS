import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import { cn } from './cn';

export type ActionTone = 'brand' | 'danger' | 'warning';

const TILE: Record<ActionTone, { cls: string; hover: string }> = {
  brand: { cls: 'bg-brand-100 text-brand-700', hover: '#1F6BFF' },
  // Colour is for meaning: use these only when the action is about something that needs attention.
  danger: { cls: 'bg-red-100 text-red-700', hover: '#B91C1C' },
  warning: { cls: 'bg-amber-100 text-amber-700', hover: '#B45309' },
};

/**
 * A card that goes somewhere: an icon tile, a title and an optional line of description. It is a real button, so it is
 * reachable by keyboard, and it uses the shared hover, press and focus behaviour.
 */
export function ActionCard({ icon, title, description, onClick, tone = 'brand', badge, locked, disabled, arrow = true, layout = 'row', className }: {
  icon: ReactNode; title: string; description?: string; onClick: () => void; tone?: ActionTone;
  badge?: string; locked?: boolean; disabled?: boolean; arrow?: boolean; layout?: 'row' | 'stack'; className?: string;
}) {
  const t = TILE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || locked}
      style={{ '--tile-hover': t.hover } as CSSProperties}
      className={cn('surface-interactive group p-4 flex gap-3', layout === 'row' ? 'items-center' : 'flex-col items-start justify-between min-h-[96px]', className)}
    >
      {badge && (
        <span className="absolute -top-2 -right-2 bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md">{badge}</span>
      )}
      <span className={cn('surface-icon relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', t.cls)} aria-hidden>
        {icon}
        {locked && (
          <span className="absolute inset-0 rounded-xl bg-black/45 flex items-center justify-center"><Lock className="w-4 h-4 text-white" /></span>
        )}
      </span>
      <span className={cn('min-w-0', layout === 'row' && 'flex-1')}>
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        {description && <span className="block text-xs text-gray-600 mt-0.5 truncate">{description}</span>}
      </span>
      {arrow && layout === 'row' && <ChevronRight className="surface-arrow w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden />}
    </button>
  );
}
