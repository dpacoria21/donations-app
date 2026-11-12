import { describe, expect, it } from 'vitest';
import type { Project } from '../src/projects/model.ts';
import { donorClaims } from './helpers/events.ts';
import {
  DRAFT_ID,
  jsonBody as body,
  managedRequest as request,
  managerClaims,
  MISSING_ID,
  NEW_ID,
  NOW,
  PUBLISHED_ID,
  setupProjects as setup,
  VALID_PROJECT as VALID,
} from './helpers/projects.ts';

describe('autorización de las rutas de gestión (HU-04, HU-08)', () => {
  it('T03: un DONANTE no puede crear proyectos → 403 (CA-04.1)', async () => {
    const { handlers, repository } = setup();
    const donorWithScope = donorClaims({ scope: 'api/projects.write' });

    const result = await handlers.createProject(request(donorWithScope, { body: VALID }));

    expect(result.statusCode).toBe(403);
    expect(await repository.findById(NEW_ID)).toBeUndefined();
  });

  it('un DONANTE tampoco puede editar ni publicar → 403', async () => {
    const { handlers } = setup();
    const donor = donorClaims({ scope: 'api/projects.write' });
    const edit = await handlers.updateProject(
      request(donor, { projectId: DRAFT_ID, body: { title: 'Cambio no autorizado' } }),
    );
    const publish = await handlers.publishProject(request(donor, { projectId: DRAFT_ID }));
    expect([edit.statusCode, publish.statusCode]).toEqual([403, 403]);
  });

  it('un GESTOR sin el scope api/projects.write → 403', async () => {
    const { handlers } = setup();
    const result = await handlers.createProject(
      request(managerClaims({ scope: 'openid email' }), { body: VALID }),
    );
    expect(result.statusCode).toBe(403);
  });

  it('un ID token → 401 (CA-03.2)', async () => {
    const { handlers } = setup();
    const result = await handlers.createProject(
      request(managerClaims({ token_use: 'id' }), { body: VALID }),
    );
    expect(result.statusCode).toBe(401);
  });
});

describe('POST /v1/projects (CA-08.1)', () => {
  it('crea el proyecto en BORRADOR, con 0 recaudado, y no aparece en el catálogo', async () => {
    const { handlers, repository } = setup();

    const result = await handlers.createProject(request(managerClaims(), { body: VALID }));

    expect(result.statusCode).toBe(201);
    expect(result.headers?.location).toBe(`/v1/projects/${NEW_ID}`);
    expect(body(result)).toEqual({
      projectId: NEW_ID,
      ...VALID,
      confirmedAmountCents: 0,
      currency: 'PEN',
      status: 'BORRADOR',
      updatedAt: NOW,
    });
    expect((await repository.listPublished()).map((p) => p.projectId)).not.toContain(NEW_ID);
  });

  it.each([
    ['meta decimal', { ...VALID, goalAmountCents: 1500.5 }],
    ['meta cero', { ...VALID, goalAmountCents: 0 }],
    ['meta negativa', { ...VALID, goalAmountCents: -100 }],
    ['meta como texto', { ...VALID, goalAmountCents: '450000' }],
    ['título vacío', { ...VALID, title: '   ' }],
    ['falta la descripción', { title: VALID.title, goalAmountCents: VALID.goalAmountCents }],
    ['intenta fijar el estado', { ...VALID, status: 'PUBLICADO' }],
    ['intenta fijar lo recaudado', { ...VALID, confirmedAmountCents: 999_999 }],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const { handlers } = setup();
    const result = await handlers.createProject(request(managerClaims(), { body: payload }));
    expect(result.statusCode).toBe(400);
    expect(body(result)).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rechaza un cuerpo ausente o que no es JSON', async () => {
    const { handlers } = setup();
    const missing = await handlers.createProject(request(managerClaims()));
    const broken = await handlers.createProject(request(managerClaims(), { rawBody: '{"title":' }));
    expect([missing.statusCode, broken.statusCode]).toEqual([400, 400]);
  });

  it('el mensaje de error nombra el campo, pero no repite el valor recibido', async () => {
    const { handlers } = setup();
    const result = await handlers.createProject(
      request(managerClaims(), { body: { ...VALID, goalAmountCents: 1234.56 } }),
    );
    expect(body(result).message).toContain('goalAmountCents');
    expect(result.body).not.toContain('1234.56');
  });
});

describe('PATCH /v1/projects/{projectId} (decisión D2)', () => {
  it('edita título y descripción de un proyecto publicado sin tocar lo recaudado', async () => {
    const { handlers } = setup();
    const result = await handlers.updateProject(
      request(managerClaims(), {
        projectId: PUBLISHED_ID,
        body: { title: 'Comedor popular de Alto Selva Alegre (2026)' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(body(result)).toMatchObject({
      title: 'Comedor popular de Alto Selva Alegre (2026)',
      confirmedAmountCents: 612_550,
      status: 'PUBLICADO',
      updatedAt: NOW,
    });
  });

  it('acepta una meta igual o mayor a lo recaudado', async () => {
    const { handlers } = setup();
    const result = await handlers.updateProject(
      request(managerClaims(), { projectId: PUBLISHED_ID, body: { goalAmountCents: 612_550 } }),
    );
    expect(result.statusCode).toBe(200);
  });

  it('rechaza una meta menor a lo recaudado → 409', async () => {
    const { handlers, repository } = setup();
    const result = await handlers.updateProject(
      request(managerClaims(), { projectId: PUBLISHED_ID, body: { goalAmountCents: 500_000 } }),
    );
    expect(result.statusCode).toBe(409);
    expect((await repository.findById(PUBLISHED_ID))?.goalAmountCents).toBe(800_000);
  });

  it('no permite editar campos protegidos ni un cuerpo vacío → 400', async () => {
    const { handlers } = setup();
    for (const payload of [{}, { status: 'BORRADOR' }, { confirmedAmountCents: 0 }]) {
      const result = await handlers.updateProject(
        request(managerClaims(), { projectId: PUBLISHED_ID, body: payload }),
      );
      expect(result.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('un proyecto inexistente o un ID inválido → 404', async () => {
    const { handlers } = setup();
    for (const projectId of [MISSING_ID, 'no-es-uuid']) {
      const result = await handlers.updateProject(
        request(managerClaims(), { projectId, body: { title: 'Título válido' } }),
      );
      expect(result.statusCode).toBe(404);
    }
  });
});

describe('PATCH /v1/projects/{projectId}/publish (CA-08.2)', () => {
  it('publica un BORRADOR y desde ese momento aparece en el catálogo', async () => {
    const { handlers, repository } = setup();
    const result = await handlers.publishProject(request(managerClaims(), { projectId: DRAFT_ID }));
    expect(result.statusCode).toBe(200);
    expect(body(result)).toMatchObject({ status: 'PUBLICADO', updatedAt: NOW });
    expect((await repository.listPublished()).map((p) => p.projectId)).toContain(DRAFT_ID);
  });

  it('publicar uno ya publicado → 409', async () => {
    const { handlers } = setup();
    const result = await handlers.publishProject(
      request(managerClaims(), { projectId: PUBLISHED_ID }),
    );
    expect(result.statusCode).toBe(409);
    expect(body(result)).toMatchObject({ code: 'CONFLICT' });
  });

  it('un proyecto inexistente → 404', async () => {
    const { handlers } = setup();
    const result = await handlers.publishProject(
      request(managerClaims(), { projectId: MISSING_ID }),
    );
    expect(result.statusCode).toBe(404);
  });
});

describe('GET /v1/manage/projects', () => {
  it('el GESTOR ve también los BORRADOR', async () => {
    const { handlers } = setup();
    const result = await handlers.listManagedProjects(request(managerClaims()));
    const items = body(result).items as Project[];
    expect(items).toHaveLength(4);
    expect(items.map((p) => p.status)).toContain('BORRADOR');
  });

  it('un DONANTE no puede ver los borradores → 403', async () => {
    const { handlers } = setup();
    const result = await handlers.listManagedProjects(
      request(donorClaims({ scope: 'api/projects.write' })),
    );
    expect(result.statusCode).toBe(403);
  });
});
