import { z } from 'zod';
import { solesToCents } from '../lib/format.ts';

/** Límites de CA-05.1 (los mismos que valida el backend). */
export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 100_000;

/** Validación del formulario, solo para la experiencia de uso: el backend decide (AD-04). */
export const donationFormSchema = z.object({
  amount: z
    .string()
    .trim()
    .refine((value) => solesToCents(value) !== null, {
      message: 'Ingresa un monto en soles, con hasta 2 decimales (por ejemplo 25.50)',
    })
    .refine(
      (value) => {
        const cents = solesToCents(value);
        return cents === null || (cents >= MIN_DONATION_CENTS && cents <= MAX_DONATION_CENTS);
      },
      { message: 'El monto debe estar entre S/ 1.00 y S/ 1,000.00' },
    ),
});

export type DonationFormValues = z.input<typeof donationFormSchema>;
