import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { forbidden, unauthorized } from '../shared/errors.ts';

export const GROUPS = ['DONANTE', 'GESTOR', 'AUDITOR'] as const;
export type Group = (typeof GROUPS)[number];

export interface Identity {
  sub: string;
  groups: readonly Group[];
}

const isGroup = (value: unknown): value is Group =>
  typeof value === 'string' && (GROUPS as readonly string[]).includes(value);

/**
 * El JWT authorizer de HTTP API entrega los claims de tipo lista como texto,
 * por ejemplo `"[DONANTE GESTOR]"`; también se acepta un arreglo real.
 * Los valores desconocidos se descartan.
 */
export function parseGroups(raw: unknown): Group[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    values = raw
      .replace(/^\[|\]$/g, '')
      .split(/[\s,]+/)
      .filter(Boolean);
  }
  return [...new Set(values.filter(isGroup))];
}

/**
 * Identidad y roles salen solo de los claims ya verificados por API Gateway,
 * nunca del cuerpo, la query ni otras cabeceras (CA-04.3, CA-05.3).
 */
export function getIdentity(event: APIGatewayProxyEventV2WithJWTAuthorizer): Identity {
  // El tipo asume que el authorizer existe; en una ruta mal configurada podría faltar.
  const claims = (
    event.requestContext.authorizer as
      APIGatewayProxyEventV2WithJWTAuthorizer['requestContext']['authorizer'] | undefined
  )?.jwt.claims;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || sub === '') throw unauthorized();
  return { sub, groups: parseGroups(claims?.['cognito:groups']) };
}

export function requireGroup(identity: Identity, group: Group): void {
  if (!identity.groups.includes(group)) throw forbidden();
}
