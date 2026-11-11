import { BaseColors, Brand, Neutral } from './tokens';
export { Brand, Neutral, Radius, Space, FontSize, TOUCH_TARGET } from './tokens';

/** Faida's shared palette: Faida Blue on Cloud (design/tokens.json). */
export const Colors = {
  ...BaseColors,
  indigo: Brand[700],
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  PENDING: '#F59E0B',
  CONFIRMED: '#2563EB',
  PACKED: '#7C3AED',
  DISPATCHED: '#F97316',
  DELIVERED: '#16A34A',
  CANCELLED: '#DC2626',
  REJECTED: '#DC2626',
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID: '#16A34A',
  PARTIAL: '#F59E0B',
  UNPAID: '#DC2626',
};

export const PRIORITY_COLORS: Record<string, string> = {
  HIGH: '#DC2626',
  MEDIUM: '#F59E0B',
  NORMAL: '#16A34A',
};
