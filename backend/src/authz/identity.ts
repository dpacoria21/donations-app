import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { forbidden, unauthorized } from '../shared/errors.ts';

export const GROUPS = ['DONANTE', 'GESTOR', 'AUDITOR'] as const;
export type Group = (typeof GROUPS)[number];

/** Scopes del resource server `api` de Cognito (design.md §4). */
export const SCOPES = {
  projectsWrite: 'api/projects.write',
  donationsWrite: 'api/donations.write',
  donationsRead: 'api/donations.read',
  auditRead: 'api/audit.read',
} as const;
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export interface Identity {
  sub: string;
  groups: readonly Group[];
  scopes: readonly string[];
}

const isGroup = (value: unknown): value is Group =>
  typeof value === 'string' && (GROUPS as readonly string[]).includes(value);

/** Lista que llega como arreglo real o como texto: `"[A B]"`, `"A B"` o `"A,B"`. */
function parseList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * El JWT authorizer de HTTP API entrega los claims de tipo lista como texto,
 * por ejemplo `"[DONANTE GESTOR]"`; también se acepta un arreglo real.
 * Los valores desconocidos se descartan.
 */
export function parseGroups(raw: unknown): Group[] {
  return [...new Set(parseList(raw).filter(isGroup))];
}

/** El claim `scope` del access token es texto separado por espacios. */
export function parseScopes(raw: unknown): string[] {
  return [...new Set(parseList(raw).filter((value) => typeof value === 'string'))];
}

/**
 * Identidad, roles y scopes salen solo de los claims ya verificados por API Gateway,
 * nunca del cuerpo, la query ni otras cabeceras (CA-04.3, CA-05.3).
 *
 * Solo se aceptan access tokens: un ID token que llegara hasta aquí (por ejemplo, por una
 * ruta sin `AuthorizationScopes`) se rechaza con 401 (CA-03.2).
 */
export function getIdentity(event: APIGatewayProxyEventV2WithJWTAuthorizer): Identity {
  // El tipo asume que el authorizer existe; en una ruta mal configurada podría faltar.
  const claims = (
    event.requestContext.authorizer as
      APIGatewayProxyEventV2WithJWTAuthorizer['requestContext']['authorizer'] | undefined
  )?.jwt.claims;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || sub === '') throw unauthorized();
  if (claims?.token_use !== 'access') throw unauthorized('Se requiere un access token');
  return {
    sub,
    groups: parseGroups(claims['cognito:groups']),
    scopes: parseScopes(claims.scope),
  };
}

export function requireGroup(identity: Identity, group: Group): void {
  if (!identity.groups.includes(group)) throw forbidden();
}

/** Defensa en profundidad: API Gateway ya exige el scope de la ruta. */
export function requireScope(identity: Identity, scope: Scope): void {
  if (!identity.scopes.includes(scope)) throw forbidden();
}
