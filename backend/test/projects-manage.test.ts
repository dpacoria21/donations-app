import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import type { Project } from '../src/projects/model.ts';
import { DynamoProjectRepository, InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import type { HttpResult } from '../src/shared/http.ts';
import { donorClaims, jwtEvent } from './helpers/events.ts';

const NEW_ID = '5b0e6a3c-1d2f-4e8a-9b7c-0a1b2c3d4e5f';
const DRAFT_ID = 'e8d4b6a2-5c3f-4e19-b7a0-9f1c2d3e4b58';
const PUBLISHED_ID = '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63'; // 612 550 céntimos recaudados
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const NOW = '2026-11-12T15:00:00.000Z';

const managerClaims = (overrides: Record<string, string> = {}) =>
  donorClaims({
    sub: 'a7c1e2f3-0000-4000-8000-0000000000aa',
    'cognito:groups': '[GESTOR]',
    scope: 'openid email api/projects.write',
    ...overrides,
  });

function setup() {
  const repository = new InMemoryProjectRepository(SEED_PROJECTS);
  const handlers = createProjectHandlers(repository, { now: () => NOW, newId: () => NEW_ID });
  return { repository, handlers };
}

function request(
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

const body = (result: HttpResult) => JSON.parse(result.body ?? 'null') as Record<string, unknown>;

const VALID = {
  title: 'Talleres de lectura en Socabaya',
  description: 'Materiales y facilitadores para talleres de lectura infantil.',
  goalAmountCents: 450_000,
};

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

describe('DynamoProjectRepository: escrituras condicionadas', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const repository = new DynamoProjectRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
    'ProjectsTable-test',
  );
  const stored = SEED_PROJECTS[1];
  const conditionFailed = (item?: Record<string, unknown>) =>
    new ConditionalCheckFailedException({
      message: 'The conditional request failed',
      $metadata: {},
      ...(item ? { Item: item as never } : {}),
    });

  beforeEach(() => {
    ddb.reset();
  });

  it('crear no sobrescribe un proyecto existente', async () => {
    ddb.on(PutCommand).resolves({});
    await repository.create({ ...(stored as Project), projectId: NEW_ID });
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.ConditionExpression).toBe(
      'attribute_not_exists(projectId)',
    );
  });

  it('editar la meta exige en la misma escritura que no baje de lo recaudado', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { ...stored, goalAmountCents: 900_000 } });

    const result = await repository.update(PUBLISHED_ID, { goalAmountCents: 900_000 }, NOW);

    expect(result.ok).toBe(true);
    const input = ddb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toBe(
      'attribute_exists(projectId) AND #confirmed <= :goalAmountCents',
    );
    expect(input?.UpdateExpression).toBe(
      'SET #updatedAt = :updatedAt, #goalAmountCents = :goalAmountCents',
    );
    expect(input?.UpdateExpression).not.toContain('confirmedAmountCents');
  });

  it('si la condición falla y el proyecto existe → GOAL_BELOW_CONFIRMED', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed({ projectId: { S: PUBLISHED_ID } }));
    await expect(repository.update(PUBLISHED_ID, { goalAmountCents: 1 }, NOW)).resolves.toEqual({
      ok: false,
      reason: 'GOAL_BELOW_CONFIRMED',
    });
  });

  it('si la condición falla y el proyecto no existe → NOT_FOUND', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    await expect(repository.publish(MISSING_ID, NOW)).resolves.toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('publicar solo cambia BORRADOR → PUBLICADO', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed({ projectId: { S: PUBLISHED_ID } }));
    await expect(repository.publish(PUBLISHED_ID, NOW)).resolves.toEqual({
      ok: false,
      reason: 'ALREADY_PUBLISHED',
    });
    expect(ddb.commandCalls(UpdateCommand)[0]?.args[0].input.ConditionExpression).toBe(
      'attribute_exists(projectId) AND #status = :draft',
    );
  });

  it('listar todo consulta el GSI por estado, sin Scan', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await repository.listAll();
    const statuses = ddb
      .commandCalls(QueryCommand)
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[':status'] as unknown);
    expect(statuses.sort()).toEqual(['BORRADOR', 'PUBLICADO']);
  });
});
