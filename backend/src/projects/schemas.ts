import { z } from 'zod';

/** Meta máxima: S/ 1 000 000, en céntimos. Evita valores absurdos o desbordes en la UI. */
export const MAX_GOAL_AMOUNT_CENTS = 100_000_000;

const title = z.string().trim().min(3).max(120);
const description = z.string().trim().min(10).max(2000);
/** Entero y positivo: nunca `float` para dinero (AD-04, CA-08.1). */
const goalAmountCents = z.int().positive().max(MAX_GOAL_AMOUNT_CENTS);

/**
 * Cuerpo de `POST /v1/projects`. `strictObject` rechaza campos extra: el cliente no puede fijar
 * `status`, `confirmedAmountCents`, `currency` ni `projectId` (CA-NF02.2, OWASP API3).
 */
export const createProjectSchema = z.strictObject({ title, description, goalAmountCents });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Cuerpo de `PATCH /v1/projects/{projectId}` (decisión D2): al menos un campo editable. */
export const updateProjectSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    goalAmountCents: goalAmountCents.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'Indique al menos un campo para editar',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectIdSchema = z.uuid();
