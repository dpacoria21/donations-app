import { z } from 'zod';
import { solesToCents } from '../lib/format.ts';

/**
 * Validación del formulario de proyectos. Es solo para la experiencia de uso: el backend aplica
 * las mismas reglas con su propio esquema Zod (backend/src/projects/schemas.ts) y es quien
 * decide (AD-04, CA-NF02.2). Los límites deben coincidir con los del backend.
 */
export const MAX_GOAL_CENTS = 100_000_000;

export const projectFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'El título debe tener al menos 3 caracteres')
    .max(120, 'El título admite como máximo 120 caracteres'),
  description: z
    .string()
    .trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres')
    .max(2000, 'La descripción admite como máximo 2000 caracteres'),
  goal: z
    .string()
    .trim()
    .refine((value) => solesToCents(value) !== null, {
      message: 'Ingresa un monto en soles, con hasta 2 decimales (por ejemplo 4500.50)',
    })
    .refine(
      (value) => {
        const cents = solesToCents(value);
        return cents === null || (cents > 0 && cents <= MAX_GOAL_CENTS);
      },
      { message: 'La meta debe ser mayor que 0 y como máximo S/ 1 000 000' },
    ),
});

export type ProjectFormValues = z.input<typeof projectFormSchema>;
