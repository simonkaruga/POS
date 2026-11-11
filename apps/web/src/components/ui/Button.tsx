import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-btn',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-btn',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-btn',
  success: 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800 shadow-btn',
};

// md is 40px and lg is 48px; sm is for dense desktop tables only. Touch screens should use md or lg (44px target).
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-md gap-1.5',
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  lg: 'h-12 px-6 text-base rounded-xl gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** A lucide icon (or any node) shown before the label. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

/** The one button. Primary is the single Faida Blue action on a screen; everything else is secondary or ghost. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT[variant], SIZE[size], fullWidth && 'w-full', className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'fullWidth'> {
  /** Required: an icon-only button has no text for a screen reader. */
  label: string;
  children: ReactNode;
}

/** A square icon button. `label` becomes aria-label and the tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, ...rest },
  ref,
) {
  const square = size === 'sm' ? 'w-8 !px-0' : size === 'lg' ? 'w-12 !px-0' : 'w-10 !px-0';
  return (
    <Button ref={ref} variant={variant} size={size} aria-label={label} title={label} className={cn(square, className)} {...rest}>
      {children}
    </Button>
  );
});
