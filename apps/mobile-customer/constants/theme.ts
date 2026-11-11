import { BaseColors } from './tokens';
export { Brand, Neutral, Radius, Space, FontSize, TOUCH_TARGET } from './tokens';

/** Faida's shared palette: Faida Blue on Cloud (design/tokens.json). */
export const Colors = {
  ...BaseColors,
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING: '#F59E0B',
  ASSIGNED: '#3B82F6',
  IN_TRANSIT: '#F97316',
  DELIVERED: '#10B981',
  CANCELLED: '#EF4444',
  FAILED: '#DC2626',
  PREPARING: '#8B5CF6',
  READY: '#059669',
};
