import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Límites de CA-05.1: de S/ 1.00 a S/ 1 000.00, en céntimos enteros (AD-04). */
export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 100_000;

/**
 * Cuerpo de `POST /v1/donations`. `strictObject` rechaza cualquier otro campo: el `donorSub`, el
 * estado y la moneda los fija el servidor (CA-05.3), y nunca se aceptan datos de pago (CA-05.5).
 */
export const createDonationSchema = z.strictObject({
  projectId: z.uuid(),
  amountCents: z.int().min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
});
export type CreateDonationInput = z.infer<typeof createDonationSchema>;

/** Cabecera `Idempotency-Key`: obligatoria y UUID (CA-05.1, CA-05.2). */
export const idempotencyKeySchema = z.uuid();

export const donationIdSchema = z.uuid();

/**
 * SHA-256 del cuerpo normalizado (design.md §5): mismas claves, mismo orden y los valores ya
 * validados. Dos cuerpos equivalentes, aunque tengan otro orden o espacios, dan el mismo hash.
 */
export function payloadHash(input: CreateDonationInput): string {
  const normalized = JSON.stringify({ projectId: input.projectId, amountCents: input.amountCents });
  return createHash('sha256').update(normalized).digest('hex');
}

/** Clave del registro de idempotencia: una por usuario y operación (requirements.md §4). */
export function idempotencyPk(donorSub: string, idempotencyKey: string): string {
  return `${donorSub}#createDonation#${idempotencyKey}`;
}

/** Los registros de idempotencia caducan a las 24 h (TTL de DynamoDB, en segundos). */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
