import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { z } from 'zod';
import { getIdentity, requireGroup, requireScope, SCOPES } from '../authz/identity.ts';
import { badRequest } from '../shared/errors.ts';
import { json, withHttp } from '../shared/http.ts';
import { memoize } from './auditor.ts';
import { AUDIT_EVENT_TYPES, type AuditEvent } from './model.ts';
import { createAuditReader, type AuditReader } from './reader.ts';

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 100;

const dateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: false })]);

/** Continuación opaca: base64url de `{ eventType, sk }`, validada antes de usarla. */
const cursorSchema = z
  .string()
  .max(512)
  .transform((value, ctx) => {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'cursor inválido' });
      return z.NEVER;
    }
  })
  .pipe(z.strictObject({ eventType: z.enum(AUDIT_EVENT_TYPES), sk: z.string().max(200) }));

/** Filtros de HU-10 (CA-10.1). Cualquier otro parámetro es un error. */
export const auditQuerySchema = z
  .strictObject({
    eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
    from: dateOrDateTime.optional(),
    to: dateOrDateTime.optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
    cursor: cursorSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` debe ser anterior o igual a `to`',
    path: ['from'],
  })
  .refine((query) => !query.cursor || query.cursor.eventType === query.eventType, {
    message: '`cursor` solo vale con el mismo `eventType` de la página anterior',
    path: ['cursor'],
  });

/** Lo que ve el auditor: el evento sin la clave interna `sk` (CA-10.2). */
export type AuditEventView = Omit<AuditEvent, 'sk'>;

/** Campos explícitos: un atributo nuevo en la tabla no se expone sin revisarlo. */
const toView = (event: AuditEvent): AuditEventView => ({
  eventType: event.eventType,
  eventId: event.eventId,
  timestamp: event.timestamp,
  requestId: event.requestId,
  actorRef: event.actorRef,
  actorRole: event.actorRole,
  action: event.action,
  resourceRef: event.resourceRef,
  outcome: event.outcome,
  ...(event.changedFields ? { changedFields: event.changedFields } : {}),
});

const encodeCursor = (key: { eventType: string; sk: string }) =>
  Buffer.from(JSON.stringify({ eventType: key.eventType, sk: key.sk })).toString('base64url');

export interface AuditHandlerOptions {
  reader?: () => AuditReader;
}

/**
 * GET /v1/audit (HU-10, extensión). API Gateway exige el scope `api/audit.read`; aquí se exige
 * además el grupo AUDITOR. El MFA lo garantiza Cognito: el trigger *pre token generation* no
 * emite tokens a un AUDITOR sin TOTP (HU-11, decisión D5), así que ningún token de AUDITOR llega
 * aquí sin segundo factor.
 *
 * Los eventos solo contienen seudónimos, recursos y resultados: nunca tokens, montos ni datos
 * personales (CA-10.2).
 */
export function createAuditHandlers(options: AuditHandlerOptions = {}) {
  const reader = memoize(options.reader ?? createAuditReader);

  return {
    listAuditEvents: withHttp(
      'audit.list',
      async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
        const identity = getIdentity(event);
        requireScope(identity, SCOPES.auditRead);
        requireGroup(identity, 'AUDITOR');

        const parsed = auditQuerySchema.safeParse(event.queryStringParameters ?? {});
        if (!parsed.success) {
          // Solo los nombres de los parámetros, nunca sus valores.
          const fields = [
            ...new Set(
              parsed.error.issues.flatMap((issue) =>
                issue.code === 'unrecognized_keys'
                  ? issue.keys.map((key) => (/^\w{1,40}$/.test(key) ? key : 'desconocido'))
                  : [issue.path.join('.')],
              ),
            ),
          ].filter(Boolean);
          throw badRequest(`Parámetros inválidos: ${fields.join(', ') || 'consulta'}`);
        }
        const query = parsed.data;
        const page = await reader().list({
          eventTypes: query.eventType ? [query.eventType] : AUDIT_EVENT_TYPES,
          from: query.from,
          to: query.to,
          limit: query.limit,
          cursor: query.cursor,
        });
        return json(200, {
          items: page.items.map(toView),
          ...(page.next ? { nextCursor: encodeCursor(page.next) } : {}),
        });
      },
    ),
  };
}

// Punto de entrada de Lambda (rol con solo `dynamodb:Query` sobre AuditEvents).
export const { listAuditEvents } = createAuditHandlers();
