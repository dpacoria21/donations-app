/**
 * Dinero: el API trabaja en céntimos enteros de PEN (AD-04). La interfaz muestra y recibe soles,
 * y convierte sin pasar por `float` para no perder céntimos (por ejemplo, 0.1 + 0.2).
 */
const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const dateTime = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

export function formatPen(cents: number): string {
  return pen.format(cents / 100);
}

/** Una fecha ausente o inválida se muestra como «—» en lugar de romper la página. */
export function formatDateTime(iso: string | undefined): string {
  const date = new Date(iso ?? '');
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

/** Soles con hasta 2 decimales, con punto o coma: «4500», «4500.5», «4500,50». */
export const SOLES_PATTERN = /^\d{1,9}(?:[.,]\d{1,2})?$/;

/** «4500,50» → 450050. Devuelve `null` si el texto no es un monto válido. */
export function solesToCents(input: string): number | null {
  const value = input.trim();
  if (!SOLES_PATTERN.test(value)) return null;
  const [soles = '0', decimals = ''] = value.split(/[.,]/);
  return Number(soles) * 100 + Number(decimals.padEnd(2, '0'));
}

/** 450050 → «4500.50», para rellenar un formulario. */
export function centsToSoles(cents: number): string {
  const soles = Math.floor(cents / 100);
  const decimals = String(cents % 100).padStart(2, '0');
  return `${String(soles)}.${decimals}`;
}

/** Avance entero de 0 a 100, igual que `progressPercent` del API. */
export function progressPercent(confirmedCents: number, goalCents: number): number {
  return goalCents > 0 ? Math.min(100, Math.floor((confirmedCents * 100) / goalCents)) : 0;
}
