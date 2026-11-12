import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { notFound } from '../shared/errors.ts';
import { json, withHttp } from '../shared/http.ts';
import { toProjectStats, toPublicProject, type Project } from './model.ts';
import { getProjectRepository, type ProjectRepository } from './repository.ts';

const projectIdSchema = z.uuid();

/** Rutas públicas: GET /v1/projects, /v1/projects/{projectId} y /v1/projects/{projectId}/stats. */
export function createProjectHandlers(repository: ProjectRepository) {
  // Un ID mal formado, inexistente o de un BORRADOR responde igual: 404 sin contenido (CA-02.2).
  async function findPublished(event: APIGatewayProxyEventV2): Promise<Project> {
    const parsed = projectIdSchema.safeParse(event.pathParameters?.projectId);
    if (!parsed.success) throw notFound('Proyecto no encontrado');
    const project = await repository.findById(parsed.data);
    if (project?.status !== 'PUBLICADO') throw notFound('Proyecto no encontrado');
    return project;
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
  };
}

// Puntos de entrada de Lambda (uno por caso de uso, cada uno con su propio rol IAM en SAM).
export const { listProjects, getProject, getProjectStats } =
  createProjectHandlers(getProjectRepository());
