import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createAuditHandlers } from '../src/audit/handlers.ts';
import { buildAuditEvent, type AuditEvent, type AuditEventType } from '../src/audit/model.ts';
import { DynamoAuditReader, InMemoryAuditReader } from '../src/audit/reader.ts';
import { InMemoryAuditLog } from '../src/audit/recorder.ts';
import type { HttpResult } from '../src/shared/http.ts';
import { donorClaims, jwtEvent } from './helpers/events.ts';
import { managerClaims } from './helpers/projects.ts';

const KEY = 'clave-de-prueba';
const AUDITOR = donorClaims({
  sub: 'c3d4e5f6-0000-4000-8000-0000000000cc',
  'cognito:groups': '[AUDITOR]',
  scope: 'openid email api/audit.read',
});
const MANAGER_SUB = 'a7c1e2f3-0000-4000-8000-0000000000aa';

let counter = 0;
function event(
  eventType: AuditEventType,
  timestamp: string,
  outcome: AuditEvent['outcome'] = 'SUCCESS',
) {
  counter += 1;
  return buildAuditEvent(
    {
      eventType,
      action: eventType.toLowerCase(),
      requestId: `req-${String(counter)}`,
      actorSub: MANAGER_SUB,
      actorRole: 'GESTOR',
      resourceRef: `project/${String(counter)}`,
      outcome,
      timestamp,
      ...(eventType === 'PROJECT_UPDATE' ? { changedFields: ['title'] } : {}),
    },
    KEY,
    () => `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
  );
}

function setup() {
  counter = 0;
  const log = new InMemoryAuditLog();
  log.events.push(
    event('PROJECT_CREATE', '2026-11-10T09:00:00.000Z'),
    event('PROJECT_UPDATE', '2026-11-11T10:00:00.000Z'),
    event('PROJECT_PUBLISH', '2026-11-12T11:00:00.000Z'),
    event('PROJECT_PUBLISH', '2026-11-12T23:59:59.999Z', 'DENIED'),
    event('DONATION_CREATE', '2026-11-13T08:00:00.000Z'),
    event('PROJECT_PUBLISH', '2026-11-14T12:00:00.000Z'),
  );
  const { listAuditEvents } = createAuditHandlers({ reader: () => new InMemoryAuditReader(log) });
  return listAuditEvents;
}

function request(
  claims: Record<string, string>,
  query?: Record<string, string>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return { ...jwtEvent(claims, { routeKey: 'GET /v1/audit' }), queryStringParameters: query };
}

const body = (result: HttpResult) =>
  JSON.parse(result.body ?? 'null') as { items: Record<string, unknown>[]; nextCursor?: string };
const times = (result: HttpResult) => body(result).items.map((item) => item.timestamp);

describe('GET /v1/audit: solo AUDITOR (CA-10.1)', () => {
  it('un AUDITOR obtiene los eventos, del más reciente al más antiguo', async () => {
    const result = await setup()(request(AUDITOR));
    expect(result.statusCode).toBe(200);
    expect(times(result)).toEqual([
      '2026-11-14T12:00:00.000Z',
      '2026-11-13T08:00:00.000Z',
      '2026-11-12T23:59:59.999Z',
      '2026-11-12T11:00:00.000Z',
      '2026-11-11T10:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
    ]);
    expect(result.headers?.['cache-control']).toBe('no-store');
  });

  it.each([
    ['DONANTE', donorClaims({ scope: 'api/audit.read' })],
    ['GESTOR', managerClaims({ scope: 'api/audit.read' })],
    ['sin grupo', donorClaims({ 'cognito:groups': '[]', scope: 'api/audit.read' })],
  ])('%s, aunque tenga el scope → 403', async (_role, claims) => {
    expect((await setup()(request(claims))).statusCode).toBe(403);
  });

  it('un AUDITOR sin el scope api/audit.read → 403', async () => {
    const claims = { ...AUDITOR, scope: 'openid email' };
    expect((await setup()(request(claims))).statusCode).toBe(403);
  });

  it('un ID token → 401', async () => {
    expect((await setup()(request({ ...AUDITOR, token_use: 'id' }))).statusCode).toBe(401);
  });
});

describe('GET /v1/audit: filtros por tipo y fecha (CA-10.1)', () => {
  it('filtra por tipo', async () => {
    const result = await setup()(request(AUDITOR, { eventType: 'PROJECT_PUBLISH' }));
    expect(body(result).items.map((item) => item.eventType)).toEqual([
      'PROJECT_PUBLISH',
      'PROJECT_PUBLISH',
      'PROJECT_PUBLISH',
    ]);
  });

  it('un rango de días incluye los dos extremos completos', async () => {
    const result = await setup()(request(AUDITOR, { from: '2026-11-11', to: '2026-11-12' }));
    expect(times(result)).toEqual([
      '2026-11-12T23:59:59.999Z',
      '2026-11-12T11:00:00.000Z',
      '2026-11-11T10:00:00.000Z',
    ]);
  });

  it('acepta instantes ISO y combina tipo y fecha', async () => {
    const result = await setup()(
      request(AUDITOR, { eventType: 'PROJECT_PUBLISH', from: '2026-11-12T12:00:00.000Z' }),
    );
    expect(times(result)).toEqual(['2026-11-14T12:00:00.000Z', '2026-11-12T23:59:59.999Z']);
  });

  it('pagina un tipo con nextCursor', async () => {
    const list = setup();
    const first = await list(request(AUDITOR, { eventType: 'PROJECT_PUBLISH', limit: '2' }));
    expect(times(first)).toEqual(['2026-11-14T12:00:00.000Z', '2026-11-12T23:59:59.999Z']);
    const cursor = body(first).nextCursor ?? '';
    expect(cursor).not.toBe('');

    const second = await list(
      request(AUDITOR, { eventType: 'PROJECT_PUBLISH', limit: '2', cursor }),
    );
    expect(times(second)).toEqual(['2026-11-12T11:00:00.000Z']);
    expect(body(second).nextCursor).toBeUndefined();
  });

  it('sin tipo devuelve los más recientes y no ofrece paginación', async () => {
    const result = await setup()(request(AUDITOR, { limit: '2' }));
    expect(body(result).items).toHaveLength(2);
    expect(body(result).nextCursor).toBeUndefined();
  });

  it.each([
    ['un parámetro desconocido', { actorRef: 'actor_x' }, 'actorRef'],
    ['un tipo inexistente', { eventType: 'LOGIN' }, 'eventType'],
    ['una fecha inválida', { from: '12/11/2026' }, 'from'],
    ['from posterior a to', { from: '2026-11-14', to: '2026-11-10' }, 'from'],
    ['limit 0', { limit: '0' }, 'limit'],
    ['limit 101', { limit: '101' }, 'limit'],
    ['un cursor alterado', { eventType: 'PROJECT_PUBLISH', cursor: 'no-es-base64-json' }, 'cursor'],
  ])('%s → 400 que nombra el parámetro sin repetir el valor', async (_case, query, field) => {
    const result = await setup()(request(AUDITOR, query));
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain(field);
    for (const value of Object.values(query)) {
      if (value !== field) expect(result.body).not.toContain(value);
    }
  });

  it('un cursor de otro tipo → 400', async () => {
    const list = setup();
    const first = await list(request(AUDITOR, { eventType: 'PROJECT_PUBLISH', limit: '1' }));
    const result = await list(
      request(AUDITOR, { eventType: 'DONATION_CREATE', cursor: body(first).nextCursor ?? '' }),
    );
    expect(result.statusCode).toBe(400);
  });
});

describe('GET /v1/audit: contenido de los eventos (CA-10.2)', () => {
  it('trae timestamp, requestId, actor seudonimizado, recurso, acción y resultado', async () => {
    const result = await setup()(request(AUDITOR, { eventType: 'PROJECT_UPDATE' }));
    expect(body(result).items[0]).toEqual({
      eventType: 'PROJECT_UPDATE',
      eventId: '00000000-0000-4000-8000-000000000002',
      timestamp: '2026-11-11T10:00:00.000Z',
      requestId: 'req-2',
      actorRef: expect.stringMatching(/^actor_[\w-]{22}$/) as string,
      actorRole: 'GESTOR',
      action: 'project_update',
      resourceRef: 'project/2',
      outcome: 'SUCCESS',
      changedFields: ['title'],
    });
  });

  it('no expone la clave interna, el sub ni datos que no sean del evento', async () => {
    const result = await setup()(request(AUDITOR));
    expect(result.body).not.toContain(MANAGER_SUB);
    expect(result.body).not.toContain('"sk"');
  });

  it('coincide con el esquema AuditEvent de docs/api.yaml', async () => {
    const spec = parse(readFileSync(new URL('../../docs/api.yaml', import.meta.url), 'utf8')) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    const documented = Object.keys(spec.components.schemas.AuditEvent?.properties ?? {}).sort();
    const result = await setup()(request(AUDITOR, { eventType: 'PROJECT_UPDATE' }));
    expect(Object.keys(body(result).items[0] ?? {}).sort()).toEqual(documented);
  });
});

describe('DynamoAuditReader', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const reader = new DynamoAuditReader(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
    'AuditEvents',
  );

  beforeEach(() => {
    ddb.reset();
    counter = 0;
  });

  it('consulta la partición del tipo con el rango de fechas, del más reciente al más antiguo', async () => {
    const stored = event('PROJECT_PUBLISH', '2026-11-12T11:00:00.000Z');
    const lastKey = { eventType: 'PROJECT_PUBLISH', sk: stored.sk };
    ddb.on(QueryCommand).resolves({ Items: [stored], LastEvaluatedKey: lastKey });

    const page = await reader.list({
      eventTypes: ['PROJECT_PUBLISH'],
      from: '2026-11-12',
      to: '2026-11-12',
      limit: 10,
    });

    expect(page).toEqual({ items: [stored], next: lastKey });
    expect(ddb.commandCalls(QueryCommand)[0]?.args[0].input).toEqual({
      TableName: 'AuditEvents',
      KeyConditionExpression: 'eventType = :type AND sk BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':type': 'PROJECT_PUBLISH',
        ':from': '2026-11-12',
        ':to': '2026-11-12~',
      },
      ScanIndexForward: false,
      Limit: 10,
      ExclusiveStartKey: undefined,
    });
  });

  it('sin tipo consulta las cinco particiones, mezcla por fecha y no pagina', async () => {
    const older = event('PROJECT_CREATE', '2026-11-10T09:00:00.000Z');
    const newer = event('DONATION_CREATE', '2026-11-13T08:00:00.000Z');
    ddb
      .on(QueryCommand)
      .resolves({ Items: [] })
      .on(QueryCommand, { ExpressionAttributeValues: { ':type': 'PROJECT_CREATE' } }, false)
      .resolves({ Items: [older], LastEvaluatedKey: { eventType: 'PROJECT_CREATE', sk: older.sk } })
      .on(QueryCommand, { ExpressionAttributeValues: { ':type': 'DONATION_CREATE' } }, false)
      .resolves({ Items: [newer] });

    const page = await reader.list({
      eventTypes: [
        'PROJECT_CREATE',
        'PROJECT_UPDATE',
        'PROJECT_PUBLISH',
        'DONATION_CREATE',
        'DONATION_SIMULATE',
      ],
      limit: 5,
    });

    expect(ddb.commandCalls(QueryCommand)).toHaveLength(5);
    expect(page).toEqual({ items: [newer, older] });
  });

  it('rechaza un registro que no tiene la forma de un evento', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ eventType: 'PROJECT_CREATE', token: 'x' }] });
    await expect(reader.list({ eventTypes: ['PROJECT_CREATE'], limit: 1 })).rejects.toThrow();
  });
});
