import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAuditEvent } from '../src/audit/model.ts';
import { InMemoryAuditLog } from '../src/audit/recorder.ts';
import { createDonationHandlers } from '../src/donations/handlers.ts';
import type { Donation } from '../src/donations/model.ts';
import {
  DynamoDonationRepository,
  InMemoryDonationRepository,
} from '../src/donations/repository.ts';
import { idempotencyPk, payloadHash } from '../src/donations/schemas.ts';
import { InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import type { HttpResult } from '../src/shared/http.ts';
import { donorClaims, jwtEvent } from './helpers/events.ts';
import { DRAFT_ID, managerClaims, MISSING_ID, PUBLISHED_ID } from './helpers/projects.ts';

const NOW = '2026-11-13T15:00:00.000Z';
const KEY = '9b2f4c1e-7a3d-4e5f-8a6b-1c2d3e4f5a6b';
const OTHER_KEY = '1f0e2d3c-4b5a-4968-8776-655443322110';
const DONOR = donorClaims();
const OTHER_DONOR = donorClaims({ sub: 'b1f0c2d3-0000-4000-8000-000000000002' });
const VALID = { projectId: PUBLISHED_ID, amountCents: 2_500 };

function setup() {
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const auditLog = new InMemoryAuditLog();
  const projects = new InMemoryProjectRepository(SEED_PROJECTS);
  const repository = new InMemoryDonationRepository([], {
    auditLog,
    projectStatus: async (projectId) => (await projects.findById(projectId))?.status,
  });
  const handlers = createDonationHandlers(repository, {
    projects: () => projects,
    now: () => NOW,
    newId,
    auditRecorder: () => auditLog,
    pseudonymKey: () => 'clave-de-prueba',
  });
  return { handlers, repository, projects, auditLog };
}

function donate(
  claims: Record<string, string>,
  options: { body?: unknown; rawBody?: string; key?: string | null } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const event = jwtEvent(claims, { routeKey: 'POST /v1/donations' });
  const key = options.key === undefined ? KEY : options.key;
  return {
    ...event,
    headers: key === null ? {} : { 'idempotency-key': key },
    body: options.rawBody ?? JSON.stringify(options.body ?? VALID),
  };
}

function byId(claims: Record<string, string>, donationId: string) {
  const event = jwtEvent(claims, { routeKey: 'GET /v1/donations/{donationId}' });
  return { ...event, pathParameters: { donationId } };
}

const body = (result: HttpResult) => JSON.parse(result.body ?? 'null') as Record<string, unknown>;

describe('POST /v1/donations (HU-05)', () => {
  it('T05: una intención válida → 201, PENDIENTE_SIMULACION y sin cargo (CA-05.1)', async () => {
    const { handlers, projects } = setup();

    const result = await handlers.createDonation(donate(DONOR));

    expect(result.statusCode).toBe(201);
    expect(body(result)).toMatchObject({
      projectId: PUBLISHED_ID,
      amountCents: 2_500,
      currency: 'PEN',
      status: 'PENDIENTE_SIMULACION',
    });
    expect(body(result)).not.toHaveProperty('donorSub');
    expect(result.headers?.location).toBe(`/v1/donations/${String(body(result).donationId)}`);
    // Crear una intención no suma nada: solo la simulación confirmada lo hará (fase 5).
    expect((await projects.findById(PUBLISHED_ID))?.confirmedAmountCents).toBe(612_550);
  });

  it('el donorSub sale del token, nunca del cuerpo (CA-05.3)', async () => {
    const { handlers, repository } = setup();
    const result = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, donorSub: OTHER_DONOR.sub } }),
    );
    expect(result.statusCode).toBe(400);
    expect(await repository.listByDonor(OTHER_DONOR.sub ?? '')).toHaveLength(0);
  });

  it.each([
    ['monto cero', 0],
    ['menos de S/ 1.00', 99],
    ['más de S/ 1 000.00', 100_001],
    ['monto negativo', -500],
    ['monto no entero', 1500.5],
    ['monto como texto', '2500'],
  ])('T04: %s → 400 (CA-05.2)', async (_case, amountCents) => {
    const { handlers, repository } = setup();
    const result = await handlers.createDonation(
      donate(DONOR, { body: { projectId: PUBLISHED_ID, amountCents } }),
    );
    expect(result.statusCode).toBe(400);
    expect(await repository.listByDonor(DONOR.sub ?? '')).toHaveLength(0);
  });

  it('acepta los límites exactos: S/ 1.00 y S/ 1 000.00', async () => {
    const { handlers } = setup();
    const min = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, amountCents: 100 } }),
    );
    const max = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, amountCents: 100_000 }, key: OTHER_KEY }),
    );
    expect([min.statusCode, max.statusCode]).toEqual([201, 201]);
  });

  it('sin Idempotency-Key o con una que no es UUID → 400 (CA-05.2)', async () => {
    const { handlers } = setup();
    const missing = await handlers.createDonation(donate(DONOR, { key: null }));
    const invalid = await handlers.createDonation(donate(DONOR, { key: 'abc-123' }));
    expect([missing.statusCode, invalid.statusCode]).toEqual([400, 400]);
    expect(body(missing).message).toContain('Idempotency-Key');
  });

  it('rechaza cualquier dato de pago: no se piden ni se guardan (CA-05.5)', async () => {
    const { handlers } = setup();
    const result = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, cardNumber: '4111111111111111', cvv: '123' } }),
    );
    expect(result.statusCode).toBe(400);
    expect(result.body).not.toContain('4111');
  });

  it('proyecto inexistente → 404; proyecto en BORRADOR → 409 (CA-05.2)', async () => {
    const { handlers } = setup();
    const missing = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, projectId: MISSING_ID } }),
    );
    const draft = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, projectId: DRAFT_ID }, key: OTHER_KEY }),
    );
    expect([missing.statusCode, draft.statusCode]).toEqual([404, 409]);
  });

  it('un GESTOR no puede donar → 403 (matriz de roles)', async () => {
    const { handlers } = setup();
    const result = await handlers.createDonation(
      donate(managerClaims({ scope: 'api/donations.write' })),
    );
    expect(result.statusCode).toBe(403);
  });

  it('un ID token → 401', async () => {
    const { handlers } = setup();
    const result = await handlers.createDonation(donate(donorClaims({ token_use: 'id' })));
    expect(result.statusCode).toBe(401);
  });
});

describe('idempotencia (CA-05.4, AD-05)', () => {
  it('T06: misma clave y mismo cuerpo → el mismo resultado y una sola donación', async () => {
    const { handlers, repository } = setup();

    const first = await handlers.createDonation(donate(DONOR));
    const second = await handlers.createDonation(donate(DONOR));

    expect(second.statusCode).toBe(201);
    expect(body(second)).toEqual(body(first));
    expect(second.headers?.['idempotency-replayed']).toBe('true');
    expect(await repository.listByDonor(DONOR.sub ?? '')).toHaveLength(1);
  });

  it('el mismo cuerpo con otro orden o espacios cuenta como el mismo (cuerpo normalizado)', async () => {
    const { handlers, repository } = setup();
    await handlers.createDonation(donate(DONOR));
    const reordered = await handlers.createDonation(
      donate(DONOR, { rawBody: `{ "amountCents": 2500,  "projectId": "${PUBLISHED_ID}" }` }),
    );
    expect(reordered.statusCode).toBe(201);
    expect(await repository.listByDonor(DONOR.sub ?? '')).toHaveLength(1);
  });

  it('T07: misma clave con otro cuerpo → 409 y no se crea otra donación', async () => {
    const { handlers, repository } = setup();
    await handlers.createDonation(donate(DONOR));

    const result = await handlers.createDonation(
      donate(DONOR, { body: { ...VALID, amountCents: 9_900 } }),
    );

    expect(result.statusCode).toBe(409);
    expect(body(result).message).toContain('Idempotency-Key');
    const own = await repository.listByDonor(DONOR.sub ?? '');
    expect(own.map((donation) => donation.amountCents)).toEqual([2_500]);
  });

  it('10 solicitudes simultáneas con la misma clave crean una sola donación', async () => {
    const { handlers, repository } = setup();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => handlers.createDonation(donate(DONOR))),
    );

    expect(results.map((result) => result.statusCode)).toEqual(Array(10).fill(201));
    expect(new Set(results.map((result) => body(result).donationId)).size).toBe(1);
    expect(await repository.listByDonor(DONOR.sub ?? '')).toHaveLength(1);
  });

  it('la clave es por usuario: otro donante con la misma clave crea su propia donación', async () => {
    const { handlers } = setup();
    const mine = await handlers.createDonation(donate(DONOR));
    const theirs = await handlers.createDonation(donate(OTHER_DONOR));
    expect(body(theirs).donationId).not.toBe(body(mine).donationId);
  });
});

describe('auditoría de donaciones (CA-10.2)', () => {
  it('registra DONATION_CREATE sin montos ni identidad; un reintento no registra otro', async () => {
    const { handlers, auditLog } = setup();
    const result = await handlers.createDonation(donate(DONOR));
    await handlers.createDonation(donate(DONOR));

    expect(auditLog.events).toHaveLength(1);
    expect(auditLog.events[0]).toMatchObject({
      eventType: 'DONATION_CREATE',
      outcome: 'SUCCESS',
      actorRole: 'DONANTE',
      resourceRef: `donation/${String(body(result).donationId)}`,
    });
    const serialized = JSON.stringify(auditLog.events);
    expect(serialized).not.toContain('2500');
    expect(serialized).not.toContain(DONOR.sub);
  });

  it('un intento de un GESTOR queda como DENIED', async () => {
    const { handlers, auditLog } = setup();
    await handlers.createDonation(donate(managerClaims({ scope: 'api/donations.write' })));
    expect(auditLog.events.map((event) => event.outcome)).toEqual(['DENIED']);
  });
});

describe('GET /v1/donations/{donationId} (decisión D1)', () => {
  it('el propietario ve su donación', async () => {
    const { handlers } = setup();
    const created = await handlers.createDonation(donate(DONOR));
    const id = String(body(created).donationId);

    const result = await handlers.getDonation(byId(DONOR, id));

    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(body(created));
  });

  it('T09: otro donante recibe 404, igual que si no existiera (CA-07.2, BOLA)', async () => {
    const { handlers } = setup();
    const created = await handlers.createDonation(donate(DONOR));
    const id = String(body(created).donationId);

    const foreign = await handlers.getDonation(byId(OTHER_DONOR, id));
    const missing = await handlers.getDonation(byId(OTHER_DONOR, MISSING_ID));

    expect(foreign.statusCode).toBe(404);
    expect(foreign.body?.replace(/"requestId":"[^"]*"/, '')).toBe(
      missing.body?.replace(/"requestId":"[^"]*"/, ''),
    );
    expect(foreign.body).not.toContain(PUBLISHED_ID);
  });

  it('un ID que no es UUID → 404', async () => {
    const { handlers } = setup();
    expect((await handlers.getDonation(byId(DONOR, 'me'))).statusCode).toBe(404);
  });

  it('T12: un GESTOR no puede consultar donaciones → 403 (CA-04.2)', async () => {
    const { handlers } = setup();
    const created = await handlers.createDonation(donate(DONOR));
    const result = await handlers.getDonation(
      byId(managerClaims({ scope: 'api/donations.read' }), String(body(created).donationId)),
    );
    expect(result.statusCode).toBe(403);
  });
});

describe('DynamoDB: la transacción de la donación', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const repository = new DynamoDonationRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
    { donations: 'Donations', idempotency: 'Idempotency', projects: 'Projects', audit: 'Audit' },
  );
  const donation: Donation = {
    donationId: '00000000-0000-4000-8000-000000000001',
    projectId: PUBLISHED_ID,
    donorSub: DONOR.sub ?? '',
    amountCents: 2_500,
    currency: 'PEN',
    status: 'PENDIENTE_SIMULACION',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const write = {
    donation,
    idempotency: {
      pk: idempotencyPk(donation.donorSub, KEY),
      payloadHash: payloadHash(VALID),
      donationId: donation.donationId,
      responseStatus: 201,
      expiresAt: 1_900_000_000,
      createdAt: NOW,
    },
    audit: buildAuditEvent(
      {
        eventType: 'DONATION_CREATE',
        action: 'donations.create',
        requestId: 'req-1',
        actorSub: donation.donorSub,
        actorRole: 'DONANTE',
        resourceRef: `donation/${donation.donationId}`,
        outcome: 'SUCCESS',
        timestamp: NOW,
      },
      'clave-de-prueba',
    ),
  };
  const canceledAt = (index: number) =>
    new TransactionCanceledException({
      message: 'Transaction cancelled',
      $metadata: {},
      CancellationReasons: [0, 1, 2, 3].map((i) => ({
        Code: i === index ? 'ConditionalCheckFailed' : 'None',
      })),
    });

  beforeEach(() => {
    ddb.reset();
  });

  it('escribe clave, donación, comprobación del proyecto y auditoría en una sola transacción', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await expect(repository.createWithIdempotency(write)).resolves.toBe('CREATED');

    const items = ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(4);
    expect(items[0]?.Put).toMatchObject({
      TableName: 'Idempotency',
      ConditionExpression: 'attribute_not_exists(pk)',
    });
    expect(items[1]?.Put).toMatchObject({
      TableName: 'Donations',
      ConditionExpression: 'attribute_not_exists(donationId)',
    });
    expect(items[2]?.ConditionCheck).toMatchObject({
      TableName: 'Projects',
      Key: { projectId: PUBLISHED_ID },
      ConditionExpression: '#status = :published',
    });
    expect(items[3]?.Put?.TableName).toBe('Audit');
  });

  it('si la clave ya existe → KEY_IN_USE; si el proyecto no está publicado → PROJECT_NOT_PUBLISHED', async () => {
    ddb.on(TransactWriteCommand).rejectsOnce(canceledAt(0)).rejectsOnce(canceledAt(2));
    await expect(repository.createWithIdempotency(write)).resolves.toBe('KEY_IN_USE');
    await expect(repository.createWithIdempotency(write)).resolves.toBe('PROJECT_NOT_PUBLISHED');
  });

  it('otro motivo de cancelación se propaga (500 genérico, sin efectos parciales)', async () => {
    ddb.on(TransactWriteCommand).rejects(canceledAt(1));
    await expect(repository.createWithIdempotency(write)).rejects.toThrow();
  });

  it('el registro de idempotencia se lee con lectura consistente', async () => {
    ddb.on(GetCommand).resolves({ Item: write.idempotency });
    await expect(repository.findIdempotency(write.idempotency.pk)).resolves.toEqual(
      write.idempotency,
    );
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input).toMatchObject({
      TableName: 'Idempotency',
      ConsistentRead: true,
    });
  });

  it('sin la tabla de idempotencia, la función no puede crear donaciones', async () => {
    const readOnly = new DynamoDonationRepository(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
      'Donations',
    );
    await expect(readOnly.createWithIdempotency(write)).rejects.toThrow('IDEMPOTENCY_TABLE');
  });
});
