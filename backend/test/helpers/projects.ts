import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { InMemoryAuditLog } from '../../src/audit/recorder.ts';
import { createProjectHandlers } from '../../src/projects/handlers.ts';
import { InMemoryProjectRepository } from '../../src/projects/repository.ts';
import { SEED_PROJECTS } from '../../src/projects/seed.ts';
import type { HttpResult } from '../../src/shared/http.ts';
import { donorClaims, jwtEvent } from './events.ts';

export const NEW_ID = '5b0e6a3c-1d2f-4e8a-9b7c-0a1b2c3d4e5f';
export const DRAFT_ID = 'e8d4b6a2-5c3f-4e19-b7a0-9f1c2d3e4b58';
/** Proyecto semilla publicado, con 612 550 céntimos recaudados y meta de 800 000. */
export const PUBLISHED_ID = '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63';
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';
export const NOW = '2026-11-12T15:00:00.000Z';
export const PSEUDONYM_KEY = 'clave-de-prueba';

export const VALID_PROJECT = {
  title: 'Talleres de lectura en Socabaya',
  description: 'Materiales y facilitadores para talleres de lectura infantil.',
  goalAmountCents: 450_000,
};

/** Claims de un access token de un GESTOR de prueba. */
export const managerClaims = (overrides: Record<string, string> = {}) =>
  donorClaims({
    sub: 'a7c1e2f3-0000-4000-8000-0000000000aa',
    'cognito:groups': '[GESTOR]',
    scope: 'openid email api/projects.write',
    ...overrides,
  });

/** Handlers con datos en memoria, reloj fijo y un registro de auditoría inspeccionable. */
export function setupProjects() {
  const auditLog = new InMemoryAuditLog();
  const repository = new InMemoryProjectRepository(SEED_PROJECTS, auditLog);
  const handlers = createProjectHandlers(repository, {
    now: () => NOW,
    newId: () => NEW_ID,
    auditRecorder: () => auditLog,
    pseudonymKey: () => PSEUDONYM_KEY,
  });
  return { repository, handlers, auditLog };
}

export function managedRequest(
  claims: Record<string, string>,
  options: { body?: unknown; rawBody?: string; projectId?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const event = jwtEvent(claims);
  return {
    ...event,
    body:
      options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    pathParameters: options.projectId ? { projectId: options.projectId } : undefined,
  };
}

export const jsonBody = (result: HttpResult) =>
  JSON.parse(result.body ?? 'null') as Record<string, unknown>;
