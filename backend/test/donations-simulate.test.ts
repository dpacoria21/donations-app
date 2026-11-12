import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
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
import { InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import type { HttpResult } from '../src/shared/http.ts';
import { donorClaims, jwtEvent } from './helpers/events.ts';
import { managerClaims, MISSING_ID, PUBLISHED_ID } from './helpers/projects.ts';

const NOW = '2026-11-14T15:00:00.000Z';
const DONOR = donorClaims();
const OTHER_DONOR = donorClaims({ sub: 'b1f0c2d3-0000-4000-8000-000000000002' });
const INITIAL_CONFIRMED = 612_550; // acumulado del proyecto semilla PUBLISHED_ID

function pending(id: number, donorSub = DONOR.sub ?? ''): Donation {
  return {
    donationId: `0d6f8a10-0000-4000-8000-00000000000${String(id)}`,
    projectId: PUBLISHED_ID,
    donorSub,
    amountCents: 2_500,
    currency: 'PEN',
    status: 'PENDIENTE_SIMULACION',
    createdAt: '2026-11-13T10:00:00.000Z',
    updatedAt: '2026-11-13T10:00:00.000Z',
  };
}

function setup(stage = 'academic') {
  let counter = 0;
  const auditLog = new InMemoryAuditLog();
  const projects = new InMemoryProjectRepository(SEED_PROJECTS);
  const repository = new InMemoryDonationRepository([pending(1), pending(2, OTHER_DONOR.sub)], {
    auditLog,
    addConfirmed: (projectId, amountCents) => {
      projects.addConfirmed(projectId, amountCents);
    },
  });
  const handlers = createDonationHandlers(repository, {
    projects: () => projects,
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    auditRecorder: () => auditLog,
    pseudonymKey: () => 'clave-de-prueba',
    stage: () => stage,
  });
  const confirmed = async () => (await projects.findById(PUBLISHED_ID))?.confirmedAmountCents;
  return { handlers, repository, auditLog, confirmed };
}

function simulate(
  claims: Record<string, string>,
  donationId: string,
  body: unknown = { outcome: 'CONFIRMADA_SIMULADA' },
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const event = jwtEvent(claims, { routeKey: 'POST /v1/donations/{donationId}/simulate' });
  return { ...event, pathParameters: { donationId }, body: JSON.stringify(body) };
}

const body = (result: HttpResult) => JSON.parse(result.body ?? 'null') as Record<string, unknown>;
const OWN = pending(1).donationId;
const FOREIGN = pending(2).donationId;

describe('POST /v1/donations/{donationId}/simulate (HU-06)', () => {
  it('confirmar suma el monto al proyecto una sola vez (CA-06.2)', async () => {
    const { handlers, confirmed } = setup();

    const result = await handlers.simulateDonation(simulate(DONOR, OWN));

    expect(result.statusCode).toBe(200);
    expect(body(result)).toMatchObject({ donationId: OWN, status: 'CONFIRMADA_SIMULADA' });
    expect(await confirmed()).toBe(INITIAL_CONFIRMED + 2_500);
  });

  it('un rechazo no suma al acumulado (CA-06.3)', async () => {
    const { handlers, confirmed } = setup();

    const result = await handlers.simulateDonation(
      simulate(DONOR, OWN, { outcome: 'RECHAZADA_SIMULADA' }),
    );

    expect(body(result)).toMatchObject({ status: 'RECHAZADA_SIMULADA' });
    expect(await confirmed()).toBe(INITIAL_CONFIRMED);
  });

  it('simular otra vez la misma donación → 409 y no vuelve a sumar', async () => {
    const { handlers, confirmed } = setup();
    await handlers.simulateDonation(simulate(DONOR, OWN));

    const again = await handlers.simulateDonation(simulate(DONOR, OWN));
    const switched = await handlers.simulateDonation(
      simulate(DONOR, OWN, { outcome: 'RECHAZADA_SIMULADA' }),
    );

    expect([again.statusCode, switched.statusCode]).toEqual([409, 409]);
    expect(await confirmed()).toBe(INITIAL_CONFIRMED + 2_500);
  });

  it('T08: 10 confirmaciones simultáneas → un solo 200 y un solo incremento (CA-NF04.1)', async () => {
    const { handlers, confirmed } = setup();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => handlers.simulateDonation(simulate(DONOR, OWN))),
    );

    const codes = results.map((result) => result.statusCode).sort();
    expect(codes).toEqual([200, ...Array<number>(9).fill(409)]);
    expect(await confirmed()).toBe(INITIAL_CONFIRMED + 2_500);
  });

  it('una donación ajena o inexistente → 404 sin tocar nada (CA-06.1, BOLA)', async () => {
    const { handlers, confirmed } = setup();
    const foreign = await handlers.simulateDonation(simulate(DONOR, FOREIGN));
    const missing = await handlers.simulateDonation(simulate(DONOR, MISSING_ID));
    expect([foreign.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(await confirmed()).toBe(INITIAL_CONFIRMED);
  });

  it.each([
    ['resultado desconocido', { outcome: 'APROBADA' }],
    ['campos extra', { outcome: 'CONFIRMADA_SIMULADA', amountCents: 999_999 }],
    ['sin resultado', {}],
  ])('rechaza con 400: %s', async (_case, payload) => {
    const { handlers, confirmed } = setup();
    const result = await handlers.simulateDonation(simulate(DONOR, OWN, payload));
    expect(result.statusCode).toBe(400);
    expect(await confirmed()).toBe(INITIAL_CONFIRMED);
  });

  it('un GESTOR no puede simular → 403', async () => {
    const { handlers } = setup();
    const result = await handlers.simulateDonation(
      simulate(managerClaims({ scope: 'api/donations.write' }), OWN),
    );
    expect(result.statusCode).toBe(403);
  });

  it('fuera del stage academic la ruta no existe: 404 incluso para el propietario (CA-06.1)', async () => {
    const { handlers, confirmed } = setup('prod');
    const result = await handlers.simulateDonation(simulate(DONOR, OWN));
    expect(result.statusCode).toBe(404);
    expect(await confirmed()).toBe(INITIAL_CONFIRMED);
  });

  it('audita la simulación sin montos; un intento repetido queda como REJECTED', async () => {
    const { handlers, auditLog } = setup();
    await handlers.simulateDonation(simulate(DONOR, OWN));
    await handlers.simulateDonation(simulate(DONOR, OWN));

    expect(auditLog.events.map((event) => [event.eventType, event.outcome])).toEqual([
      ['DONATION_SIMULATE', 'SUCCESS'],
      ['DONATION_SIMULATE', 'REJECTED'],
    ]);
    expect(auditLog.events[0]).toMatchObject({
      resourceRef: `donation/${OWN}`,
      changedFields: ['status'],
    });
    expect(JSON.stringify(auditLog.events)).not.toContain('2500');
  });
});

describe('DynamoDB: la transacción de la simulación (CA-NF04.2)', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const repository = new DynamoDonationRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
    { donations: 'Donations', projects: 'Projects', audit: 'Audit' },
  );
  const audit = buildAuditEvent(
    {
      eventType: 'DONATION_SIMULATE',
      action: 'donations.simulate',
      requestId: 'req-1',
      actorSub: DONOR.sub ?? '',
      actorRole: 'DONANTE',
      resourceRef: `donation/${OWN}`,
      outcome: 'SUCCESS',
      timestamp: NOW,
    },
    'clave-de-prueba',
  );
  const items = () => ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];

  beforeEach(() => {
    ddb.reset();
  });

  it('confirmar: cambio condicionado + ADD al proyecto + auditoría, en una transacción', async () => {
    ddb.on(TransactWriteCommand).resolves({});

    const result = await repository.simulate({
      donation: pending(1),
      outcome: 'CONFIRMADA_SIMULADA',
      now: NOW,
      audit,
    });

    expect(result).toMatchObject({ ok: true, donation: { status: 'CONFIRMADA_SIMULADA' } });
    const [donation, project, event] = items();
    expect(donation?.Update).toMatchObject({
      TableName: 'Donations',
      ConditionExpression: '#status = :pending AND donorSub = :sub',
    });
    expect(donation?.Update?.ExpressionAttributeValues).toMatchObject({
      ':pending': 'PENDIENTE_SIMULACION',
      ':sub': DONOR.sub,
    });
    expect(project?.Update).toMatchObject({
      TableName: 'Projects',
      Key: { projectId: PUBLISHED_ID },
      UpdateExpression: 'ADD confirmedAmountCents :amount',
      ExpressionAttributeValues: { ':amount': 2_500 },
    });
    expect(event?.Put?.TableName).toBe('Audit');
  });

  it('rechazar no toca el proyecto', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repository.simulate({
      donation: pending(1),
      outcome: 'RECHAZADA_SIMULADA',
      now: NOW,
      audit,
    });
    const tables = items().map((item) => item.Update?.TableName ?? item.Put?.TableName);
    expect(tables).toEqual(['Donations', 'Audit']);
  });

  it('si la condición de la donación falla (ya simulada) → NOT_PENDING', async () => {
    ddb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [
          { Code: 'ConditionalCheckFailed' },
          { Code: 'None' },
          { Code: 'None' },
        ],
      }),
    );
    await expect(
      repository.simulate({
        donation: pending(1),
        outcome: 'CONFIRMADA_SIMULADA',
        now: NOW,
        audit,
      }),
    ).resolves.toEqual({ ok: false, reason: 'NOT_PENDING' });
  });
});
