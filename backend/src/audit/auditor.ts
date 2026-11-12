import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { getIdentity, type Identity } from '../authz/identity.ts';
import { AppError } from '../shared/errors.ts';
import type { HttpResult } from '../shared/http.ts';
import { buildAuditEvent, type AuditEvent, type AuditEventType } from './model.ts';
import { recordSafely, type AuditRecorder } from './recorder.ts';

export interface AuditorOptions {
  now: () => string;
  newId: () => string;
  /** Registro de intentos denegados o rechazados (se crea al primer uso). */
  recorder: () => AuditRecorder;
  pseudonymKey: () => string;
}

/** Contexto de una operación auditada. */
export interface AuditContext {
  /** Evento de éxito, que el repositorio guarda en la misma transacción que el cambio. */
  success: (resourceRef: string, changedFields?: string[]) => AuditEvent;
}

export interface AuditedOperation {
  eventType: AuditEventType;
  action: string;
  /** Recurso que se anota si la operación falla (por ejemplo `project/<id>` o `project/-`). */
  failureResourceRef: () => string;
}

/** Lazy: las funciones de solo lectura no necesitan (ni tienen permiso para) la auditoría. */
export function memoize<T>(factory: () => T): () => T {
  let value: { current: T } | undefined;
  return () => (value ??= { current: factory() }).current;
}

/**
 * Ejecuta una operación y la audita (CA-08.3, CA-10.2):
 * - éxito: el evento viaja con el cambio en la misma transacción (lo guarda el repositorio);
 * - 403 → DENIED; 400/404/409 → REJECTED, registrados aparte;
 * - 401 (sin identidad verificable) y 500 no se auditan aquí: quedan en los logs.
 */
export function createAuditor(options: AuditorOptions) {
  return async function audited(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    operation: AuditedOperation,
    run: (identity: Identity, audit: AuditContext) => Promise<HttpResult>,
  ): Promise<HttpResult> {
    const identity = getIdentity(event);
    const timestamp = options.now();
    const build = (outcome: AuditEvent['outcome'], resourceRef: string, changedFields?: string[]) =>
      buildAuditEvent(
        {
          eventType: operation.eventType,
          action: operation.action,
          requestId: event.requestContext.requestId,
          actorSub: identity.sub,
          actorRole: identity.groups[0] ?? null,
          resourceRef,
          outcome,
          changedFields,
          timestamp,
        },
        options.pseudonymKey(),
        options.newId,
      );

    try {
      return await run(identity, {
        success: (resourceRef, changedFields) => build('SUCCESS', resourceRef, changedFields),
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        await recordSafely(
          options.recorder(),
          build(error.statusCode === 403 ? 'DENIED' : 'REJECTED', operation.failureResourceRef()),
        );
      }
      throw error;
    }
  };
}
