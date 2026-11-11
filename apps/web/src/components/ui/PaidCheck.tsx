/**
 * The Faida "paid" tick: a circle with a check that draws itself (styles in index.css, `.paid-check`).
 * It takes its colour from the text colour, so `text-white` on a green toast or `text-green-600` on a card both work.
 * Shown once when a sale is paid; under reduced motion the tick simply appears.
 */
export function PaidCheck({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`paid-check flex-shrink-0 ${className}`} width={size} height={size} viewBox="0 0 112 112" aria-hidden="true">
      <circle cx="56" cy="56" r="52" />
      <path d="M34 58 l15 15 l30 -32" />
    </svg>
  );
}
