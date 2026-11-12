import { createHmac, randomUUID } from 'node:crypto';

/** Tipos de evento (partición de la tabla `AuditEvents`, design.md §5). */
export const AUDIT_EVENT_TYPES = [
  'PROJECT_CREATE',
  'PROJECT_UPDATE',
  'PROJECT_PUBLISH',
  'DONATION_CREATE',
  'DONATION_SIMULATE',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/**
 * - `SUCCESS`: la operación se aplicó (se guarda en la misma transacción que el cambio).
 * - `DENIED`: sin permiso (403).
 * - `REJECTED`: datos inválidos, recurso inexistente o conflicto de estado (400, 404, 409).
 */
export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'REJECTED';

/**
 * Evento de auditoría (requirements.md §4, CA-08.3, CA-10.2). Nunca contiene tokens, claves,
 * montos ni datos personales: el actor es un seudónimo y de una edición solo se guardan los
 * nombres de los campos cambiados, no sus valores.
 */
export interface AuditEvent {
  /** Partición: tipo de evento, para filtrar por tipo (HU-10). */
  eventType: AuditEventType;
  /** Orden: `timestamp#eventId`, para filtrar por fecha (HU-10). */
  sk: string;
  eventId: string;
  timestamp: string;
  /** Correlación con los logs de Lambda y de API Gateway (CA-NF07.1). */
  requestId: string;
  actorRef: string;
  /** Grupo con el que actuó, si tenía alguno. */
  actorRole: string | null;
  action: string;
  resourceRef: string;
  outcome: AuditOutcome;
  /** Solo en ediciones: nombres de los campos modificados. */
  changedFields?: string[];
}

export interface AuditEventInput {
  eventType: AuditEventType;
  action: string;
  requestId: string;
  actorSub: string;
  actorRole: string | null;
  resourceRef: string;
  outcome: AuditOutcome;
  changedFields?: string[];
  timestamp: string;
}

/**
 * Seudónimo estable del actor: HMAC-SHA256 del `sub` con una clave del despliegue. El mismo
 * usuario siempre produce el mismo seudónimo (se pueden seguir sus acciones), pero el seudónimo
 * no revela el `sub` de Cognito a quien lee la auditoría.
 */
export function pseudonymize(sub: string, key: string): string {
  return `actor_${createHmac('sha256', key).update(sub).digest('base64url').slice(0, 22)}`;
}

export function buildAuditEvent(
  input: AuditEventInput,
  key: string,
  newId: () => string = randomUUID,
): AuditEvent {
  const eventId = newId();
  return {
    eventType: input.eventType,
    sk: `${input.timestamp}#${eventId}`,
    eventId,
    timestamp: input.timestamp,
    requestId: input.requestId,
    actorRef: pseudonymize(input.actorSub, key),
    actorRole: input.actorRole,
    action: input.action,
    resourceRef: input.resourceRef,
    outcome: input.outcome,
    ...(input.changedFields ? { changedFields: input.changedFields } : {}),
  };
}

/**
 * Clave del seudónimo. En AWS la plantilla usa el `StackId` (único por despliegue); en local,
 * una clave fija de desarrollo. En Lambda es obligatoria.
 */
export function getPseudonymKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.AUDIT_PSEUDONYM_KEY?.trim();
  if (key) return key;
  if (env.AWS_LAMBDA_FUNCTION_NAME)
    throw new Error('Falta la variable de entorno AUDIT_PSEUDONYM_KEY');
  return 'clave-local-de-desarrollo';
}
