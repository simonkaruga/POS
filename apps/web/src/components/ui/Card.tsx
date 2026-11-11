import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { cn } from './cn';

/**
 * A white surface on the Cloud page. Give it `onClick` and `interactive` and it becomes a button-like card: it lifts
 * on hover, settles when pressed, shows a focus ring and answers Enter and Space. A card that only displays data stays still.
 */
export function Card({ className, interactive, onClick, onKeyDown, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  if (interactive && onClick) {
    const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e as unknown as React.MouseEvent<HTMLDivElement>); }
    };
    return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={handleKey} className={cn('surface-interactive', className)} {...rest} />;
  }
  return <div onClick={onClick} onKeyDown={onKeyDown} className={cn('surface', className)} {...rest} />;
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-gray-900 truncate">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...rest} />;
}
