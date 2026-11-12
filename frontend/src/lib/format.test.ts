import { describe, expect, it } from 'vitest';
import {
  centsToSoles,
  formatDateTime,
  formatPen,
  progressPercent,
  solesToCents,
} from './format.ts';

describe('dinero en PEN (AD-04, CA-09.1)', () => {
  it.each([
    ['4500', 450_000],
    ['4500.5', 450_050],
    ['4500,50', 450_050],
    ['0.10', 10],
    [' 12.34 ', 1_234],
  ])('«%s» son %i céntimos, sin errores de coma flotante', (input, cents) => {
    expect(solesToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '12.345', '-5', '1e3', '12.', '.5'])(
    '«%s» no es un monto válido',
    (input) => {
      expect(solesToCents(input)).toBeNull();
    },
  );

  it('convierte céntimos a soles para un formulario', () => {
    expect(centsToSoles(450_050)).toBe('4500.50');
    expect(centsToSoles(7)).toBe('0.07');
  });

  it('formatea en soles peruanos', () => {
    expect(formatPen(612_550)).toMatch(/S\/\s?6[,.]?125[.,]50/);
  });

  it('una fecha ausente o inválida se muestra como «—» sin romper la página', () => {
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('no es fecha')).toBe('—');
    expect(formatDateTime('2026-11-09T18:45:00.000Z')).toMatch(/2026/);
  });

  it('el avance es entero y no supera 100', () => {
    expect(progressPercent(612_550, 800_000)).toBe(76);
    expect(progressPercent(900_000, 800_000)).toBe(100);
    expect(progressPercent(0, 0)).toBe(0);
  });
});
