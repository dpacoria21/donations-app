import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  buildAuditEvent,
  getPseudonymKey,
  type AuditEvent,
  type AuditEventType,
} from '../audit/model.ts';
import { createAuditRecorder, recordSafely, type AuditRecorder } from '../audit/recorder.ts';
import {
  getIdentity,
  requireGroup,
  requireScope,
  SCOPES,
  type Identity,
} from '../authz/identity.ts';
import { parseJsonBody } from '../shared/body.ts';
import { AppError, conflict, notFound } from '../shared/errors.ts';
import { json, withHttp, type HttpResult } from '../shared/http.ts';
import { toProjectStats, toPublicProject, type Project } from './model.ts';
import { getProjectRepository, type ProjectRepository } from './repository.ts';
import { createProjectSchema, projectIdSchema, updateProjectSchema } from './schemas.ts';

export interface ProjectHandlerOptions {
  /** Reloj e identificadores inyectables para las pruebas. */
  now?: () => string;
  newId?: () => string;
  /** Registro de intentos denegados o rechazados. Se crea al primer uso. */
  auditRecorder?: () => AuditRecorder;
  /** Clave del seudónimo del actor. Se lee al primer uso. */
  pseudonymKey?: () => string;
}

const PROJECT_NOT_FOUND = 'Proyecto no encontrado';

type ManagedEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

/** Contexto de una operación de gestión auditada. */
interface AuditContext {
  /** Evento de éxito, que el repositorio guarda en la misma transacción que el cambio. */
  success: (resourceRef: string, changedFields?: string[]) => AuditEvent;
}

/** Lazy: las funciones de solo lectura no necesitan (ni tienen permiso para) la auditoría. */
function memoize<T>(factory: () => T): () => T {
  let value: { current: T } | undefined;
  return () => (value ??= { current: factory() }).current;
}

/**
 * Rutas públicas (catálogo) y de gestión (GESTOR con `api/projects.write`, HU-08).
 * API Gateway ya verificó el access token y el scope de las rutas de gestión; aquí se exige
 * además el scope y el grupo GESTOR (defensa en profundidad, CA-04.1).
 */
export function createProjectHandlers(
  repository: ProjectRepository,
  options: ProjectHandlerOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? randomUUID;
  const recorder = memoize(options.auditRecorder ?? createAuditRecorder);
  const pseudonymKey = memoize(options.pseudonymKey ?? getPseudonymKey);

  // Un ID mal formado, inexistente o de un BORRADOR responde igual: 404 sin contenido (CA-02.2).
  async function findPublished(event: APIGatewayProxyEventV2): Promise<Project> {
    const parsed = projectIdSchema.safeParse(event.pathParameters?.projectId);
    if (!parsed.success) throw notFound(PROJECT_NOT_FOUND);
    const project = await repository.findById(parsed.data);
    if (project?.status !== 'PUBLICADO') throw notFound(PROJECT_NOT_FOUND);
    return project;
  }

  function requireManager(identity: Identity): void {
    requireScope(identity, SCOPES.projectsWrite);
    requireGroup(identity, 'GESTOR');
  }

  function managedProjectId(event: ManagedEvent): string {
    const parsed = projectIdSchema.safeParse(event.pathParameters?.projectId);
    if (!parsed.success) throw notFound(PROJECT_NOT_FOUND);
    return parsed.data;
  }

  /**
   * Ejecuta una operación de gestión y la audita (CA-08.3, CA-10.2):
   * - éxito: el evento viaja con el cambio en la misma transacción;
   * - 403 → DENIED; 400/404/409 → REJECTED, registrados aparte;
   * - 401 (sin identidad verificable) y 500 no se auditan aquí: quedan en los logs.
   */
  async function audited(
    event: ManagedEvent,
    eventType: AuditEventType,
    action: string,
    run: (identity: Identity, audit: AuditContext) => Promise<HttpResult>,
  ): Promise<HttpResult> {
    const identity = getIdentity(event);
    const timestamp = now();
    const build = (outcome: AuditEvent['outcome'], resourceRef: string, changedFields?: string[]) =>
      buildAuditEvent(
        {
          eventType,
          action,
          requestId: event.requestContext.requestId,
          actorSub: identity.sub,
          actorRole: identity.groups[0] ?? null,
          resourceRef,
          outcome,
          changedFields,
          timestamp,
        },
        pseudonymKey(),
        newId,
      );

    try {
      return await run(identity, {
        success: (resourceRef, changedFields) => build('SUCCESS', resourceRef, changedFields),
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        const target = event.pathParameters?.projectId;
        const resourceRef = projectIdSchema.safeParse(target).success
          ? `project/${String(target)}`
          : 'project/-';
        await recordSafely(
          recorder(),
          build(error.statusCode === 403 ? 'DENIED' : 'REJECTED', resourceRef),
        );
      }
      throw error;
    }
  }

  return {
    listProjects: withHttp<APIGatewayProxyEventV2>('projects.list', async () => {
      const projects = await repository.listPublished();
      return json(200, { items: projects.map(toPublicProject) });
    }),

    getProject: withHttp('projects.get', async (event: APIGatewayProxyEventV2) =>
      json(200, toPublicProject(await findPublished(event))),
    ),

    getProjectStats: withHttp('projects.stats', async (event: APIGatewayProxyEventV2) =>
      json(200, toProjectStats(await findPublished(event))),
    ),

    /** GET /v1/manage/projects: todos los proyectos, también los BORRADOR. Solo lectura. */
    listManagedProjects: withHttp('projects.listManaged', async (event: ManagedEvent) => {
      requireManager(getIdentity(event));
      const projects = await repository.listAll();
      return json(200, { items: projects.map(toPublicProject) });
    }),

    /** POST /v1/projects: crea en BORRADOR con 0 recaudado (CA-08.1). */
    createProject: withHttp('projects.create', (event: ManagedEvent) =>
      audited(event, 'PROJECT_CREATE', 'projects.create', async (identity, audit) => {
        requireManager(identity);
        const input = parseJsonBody(event, createProjectSchema);
        const timestamp = now();
        const project: Project = {
          projectId: newId(),
          ...input,
          confirmedAmountCents: 0,
          currency: 'PEN',
          status: 'BORRADOR',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await repository.create(project, audit.success(`project/${project.projectId}`));
        const response = json(201, toPublicProject(project));
        return {
          ...response,
          headers: { ...response.headers, location: `/v1/projects/${project.projectId}` },
        };
      }),
    ),

    /** PATCH /v1/projects/{projectId}: edición según la decisión D2. */
    updateProject: withHttp('projects.update', (event: ManagedEvent) =>
      audited(event, 'PROJECT_UPDATE', 'projects.update', async (identity, audit) => {
        requireManager(identity);
        const projectId = managedProjectId(event);
        const changes = parseJsonBody(event, updateProjectSchema);
        const result = await repository.update(
          projectId,
          changes,
          now(),
          // Solo los nombres de los campos, nunca los valores (CA-10.2).
          audit.success(`project/${projectId}`, Object.keys(changes).sort()),
        );
        if (!result.ok) {
          if (result.reason === 'NOT_FOUND') throw notFound(PROJECT_NOT_FOUND);
          throw conflict('La meta no puede ser menor que el monto ya recaudado');
        }
        return json(200, toPublicProject(result.project));
      }),
    ),

    /** PATCH /v1/projects/{projectId}/publish: BORRADOR → PUBLICADO (CA-08.2). */
    publishProject: withHttp('projects.publish', (event: ManagedEvent) =>
      audited(event, 'PROJECT_PUBLISH', 'projects.publish', async (identity, audit) => {
        requireManager(identity);
        const projectId = managedProjectId(event);
        const result = await repository.publish(
          projectId,
          now(),
          audit.success(`project/${projectId}`),
        );
        if (!result.ok) {
          if (result.reason === 'NOT_FOUND') throw notFound(PROJECT_NOT_FOUND);
          throw conflict('El proyecto ya está publicado');
        }
        return json(200, toPublicProject(result.project));
      }),
    ),
  };
}

// Puntos de entrada de Lambda (uno por caso de uso, cada uno con su propio rol IAM en SAM).
export const {
  listProjects,
  getProject,
  getProjectStats,
  listManagedProjects,
  createProject,
  updateProject,
  publishProject,
} = createProjectHandlers(getProjectRepository());
