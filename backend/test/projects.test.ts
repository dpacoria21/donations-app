import { describe, expect, it } from 'vitest';
import type { Project } from '../src/projects/model.ts';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import { InMemoryProjectRepository, type ProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import type { HttpResult } from '../src/shared/http.ts';
import { httpEvent } from './helpers/events.ts';

const PUBLISHED_ID = '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63';
const DRAFT_ID = 'e8d4b6a2-5c3f-4e19-b7a0-9f1c2d3e4b58';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const handlers = createProjectHandlers(new InMemoryProjectRepository(SEED_PROJECTS));

function body(result: HttpResult): Record<string, unknown> {
  return JSON.parse(result.body ?? 'null') as Record<string, unknown>;
}

const byId = (projectId: string) => httpEvent({ pathParameters: { projectId } });

describe('GET /v1/projects (HU-01)', () => {
  it('T01 / CA-01.1, CA-01.2: lista solo proyectos PUBLICADO, sin borradores', async () => {
    const result = await handlers.listProjects(httpEvent());
    expect(result.statusCode).toBe(200);
    const items = body(result).items as Project[];
    expect(items).toHaveLength(3);
    expect(items.every((project) => project.status === 'PUBLICADO')).toBe(true);
    expect(items.map((project) => project.projectId)).not.toContain(DRAFT_ID);
    expect(items[0]).toEqual({
      projectId: expect.any(String) as unknown,
      title: expect.any(String) as unknown,
      description: expect.any(String) as unknown,
      goalAmountCents: expect.any(Number) as unknown,
      confirmedAmountCents: expect.any(Number) as unknown,
      currency: 'PEN',
      status: 'PUBLICADO',
    });
  });

  it('ordena por fecha de creación, del más reciente al más antiguo', async () => {
    const items = body(await handlers.listProjects(httpEvent())).items as Project[];
    expect(items.map((project) => project.projectId)).toEqual([
      'c25e8f73-9a1b-4d06-8f4e-6b3a2c1d0e95',
      '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63',
      '3f6c2a1e-8b4d-4c7a-9e21-5a0d7b3c9f10',
    ]);
  });

  it('CA-01.3: sin proyectos publicados devuelve una lista vacía, no un error', async () => {
    const empty = createProjectHandlers(new InMemoryProjectRepository([]));
    const result = await empty.listProjects(httpEvent());
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual({ items: [] });
  });
});

describe('GET /v1/projects/{projectId} (HU-02)', () => {
  it('CA-02.1: devuelve el detalle de un proyecto publicado', async () => {
    const result = await handlers.getProject(byId(PUBLISHED_ID));
    expect(result.statusCode).toBe(200);
    expect(body(result)).toMatchObject({
      projectId: PUBLISHED_ID,
      status: 'PUBLICADO',
      currency: 'PEN',
    });
  });

  it.each([
    ['inexistente', MISSING_ID],
    ['en BORRADOR', DRAFT_ID],
    ['con ID mal formado', 'no-es-un-uuid'],
  ])('CA-02.2: un proyecto %s devuelve 404 sin revelar contenido', async (_case, projectId) => {
    const result = await handlers.getProject(
      httpEvent({ pathParameters: { projectId }, requestId: 'req-404' }),
    );
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({
      code: 'NOT_FOUND',
      message: 'Proyecto no encontrado',
      requestId: 'req-404',
    });
  });

  it('404 cuando falta el parámetro de ruta', async () => {
    const result = await handlers.getProject(httpEvent());
    expect(result.statusCode).toBe(404);
  });
});

describe('GET /v1/projects/{projectId}/stats (HU-09)', () => {
  it('CA-09.1, CA-09.2: devuelve solo cifras agregadas confirmadas', async () => {
    const result = await handlers.getProjectStats(byId(PUBLISHED_ID));
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual({
      projectId: PUBLISHED_ID,
      goalAmountCents: 800_000,
      confirmedAmountCents: 612_550,
      currency: 'PEN',
      progressPercent: 76,
    });
  });

  it('el porcentaje de avance no supera 100', async () => {
    const overGoal: Project = {
      projectId: '5b1e9c2d-4f3a-4e8b-9c7d-2a6f1e0b3d84',
      title: 'Meta superada',
      description: 'Proyecto de prueba con más recaudado que la meta.',
      currency: 'PEN',
      status: 'PUBLICADO',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      goalAmountCents: 1_000,
      confirmedAmountCents: 5_000,
    };
    const single = createProjectHandlers(new InMemoryProjectRepository([overGoal]));
    const result = await single.getProjectStats(byId(overGoal.projectId));
    expect(body(result).progressPercent).toBe(100);
  });

  it('las estadísticas de un borrador también son 404', async () => {
    const result = await handlers.getProjectStats(byId(DRAFT_ID));
    expect(result.statusCode).toBe(404);
  });
});

describe('manejo de errores', () => {
  it('un fallo inesperado responde 500 genérico sin detalles internos', async () => {
    const failing: ProjectRepository = {
      listPublished: () => Promise.reject(new Error('detalle interno: tabla Projects')),
      findById: () => Promise.reject(new Error('detalle interno')),
    };
    const result = await createProjectHandlers(failing).listProjects(
      httpEvent({ requestId: 'req-500' }),
    );
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({
      code: 'INTERNAL',
      message: 'Error interno',
      requestId: 'req-500',
    });
    expect(result.body).not.toContain('tabla');
  });

  it('las respuestas JSON no se almacenan en caché', async () => {
    const result = await handlers.listProjects(httpEvent());
    expect(result.headers).toMatchObject({ 'cache-control': 'no-store' });
  });
});
