import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem<T extends string> { id: T; label: string; icon?: ReactNode; count?: number }

/**
 * Tabs that never clip: the row scrolls sideways when it is too wide, and the active tab scrolls into view.
 * One look everywhere: a Faida Blue underline on the active tab.
 */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<TabItem<T>>; value: T; onChange: (id: T) => void; className?: string }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [value]);

  return (
    <div role="tablist" className={cn('flex gap-0.5 overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={active ? activeRef : undefined}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-2 px-3 h-11 -mb-px text-sm font-semibold whitespace-nowrap border-b-2 transition-colors flex-shrink-0',
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300',
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className={cn('text-xs rounded-full px-1.5 py-0.5', active ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-600')}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
