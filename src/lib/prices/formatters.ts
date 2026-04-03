/**
 * Shkad Aadel — Price/date formatting helpers (Arabic-IQ locale).
 */

export function formatPrice(price: number): string {
  return `${Number(price).toLocaleString('ar-IQ')} د.ع`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
