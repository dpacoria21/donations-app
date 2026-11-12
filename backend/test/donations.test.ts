import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDonationHandlers } from '../src/donations/handlers.ts';
import type { Donation } from '../src/donations/model.ts';
import {
  createDonationRepository,
  DONATIONS_DONOR_INDEX,
  DynamoDonationRepository,
  InMemoryDonationRepository,
} from '../src/donations/repository.ts';
import { donorClaims, jwtEvent } from './helpers/events.ts';

const DONOR = donorClaims().sub ?? '';
const OTHER_DONOR = 'b1f0c2d3-0000-4000-8000-000000000002';
const PROJECT = '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63';

function donation(id: number, donorSub: string, createdAt: string): Donation {
  return {
    donationId: `0d6f8a10-0000-4000-8000-00000000000${String(id)}`,
    projectId: PROJECT,
    donorSub,
    amountCents: 2_500 * id,
    currency: 'PEN',
    status: 'PENDIENTE_SIMULACION',
    createdAt,
    updatedAt: createdAt,
  };
}

const OLDEST_OWN = donation(1, DONOR, '2026-11-10T10:00:00.000Z');
const OTHERS = donation(2, OTHER_DONOR, '2026-11-10T11:00:00.000Z');
const NEWEST_OWN = donation(3, DONOR, '2026-11-11T09:00:00.000Z');
const DONATIONS = [OLDEST_OWN, OTHERS, NEWEST_OWN];

const { getMyDonations } = createDonationHandlers(new InMemoryDonationRepository(DONATIONS));
const ROUTE = { routeKey: 'GET /v1/donations/me' };
const body = (raw: string | undefined) => JSON.parse(raw ?? 'null') as Record<string, unknown>;

describe('GET /v1/donations/me (HU-07)', () => {
  it('devuelve solo las donaciones del sub del token, de la más reciente a la más antigua', async () => {
    const result = await getMyDonations(jwtEvent(donorClaims(), ROUTE));

    expect(result.statusCode).toBe(200);
    const items = body(result.body).items as Record<string, unknown>[];
    expect(items.map((item) => item.donationId)).toEqual([
      NEWEST_OWN.donationId,
      OLDEST_OWN.donationId,
    ]);
  });

  it('no repite donorSub en la respuesta', async () => {
    const result = await getMyDonations(jwtEvent(donorClaims(), ROUTE));
    const items = body(result.body).items as Record<string, unknown>[];
    for (const item of items) expect(item).not.toHaveProperty('donorSub');
  });

  it('un usuario sin donaciones recibe una lista vacía', async () => {
    const result = await getMyDonations(
      jwtEvent(donorClaims({ sub: 'b1f0c2d3-0000-4000-8000-000000000099' }), ROUTE),
    );
    expect(body(result.body)).toEqual({ items: [] });
  });

  it('un GESTOR no puede ver historiales de donantes: 403 (CA-04.2, T12)', async () => {
    const result = await getMyDonations(
      jwtEvent(donorClaims({ 'cognito:groups': '[GESTOR]' }), ROUTE),
    );
    expect(result.statusCode).toBe(403);
    expect(body(result.body)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sin el scope api/donations.read: 403', async () => {
    const result = await getMyDonations(
      jwtEvent(donorClaims({ scope: 'openid api/donations.write' }), ROUTE),
    );
    expect(result.statusCode).toBe(403);
  });

  it('un ID token que llegara al handler: 401 (CA-03.2)', async () => {
    const result = await getMyDonations(jwtEvent(donorClaims({ token_use: 'id' }), ROUTE));
    expect(result.statusCode).toBe(401);
    expect(body(result.body)).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('DynamoDonationRepository', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const repository = new DynamoDonationRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
    'DonationsTable-test',
  );

  beforeEach(() => {
    ddb.reset();
  });

  it('consulta el GSI donorSub-createdAt con el sub recibido', async () => {
    ddb.on(QueryCommand).resolves({ Items: [NEWEST_OWN, OLDEST_OWN] });

    await expect(repository.listByDonor(DONOR)).resolves.toEqual([NEWEST_OWN, OLDEST_OWN]);
    expect(ddb.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      TableName: 'DonationsTable-test',
      IndexName: DONATIONS_DONOR_INDEX,
      KeyConditionExpression: 'donorSub = :donorSub',
      ExpressionAttributeValues: { ':donorSub': DONOR },
      ScanIndexForward: false,
    });
  });

  it('rechaza un registro con un monto no entero (AD-04)', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...OLDEST_OWN, amountCents: 12.5 }] });
    await expect(repository.listByDonor(DONOR)).rejects.toThrow();
  });

  it('en Lambda exige DONATIONS_TABLE', () => {
    expect(() => createDonationRepository({ AWS_LAMBDA_FUNCTION_NAME: 'x' })).toThrow(
      'DONATIONS_TABLE',
    );
    expect(createDonationRepository({ DONATIONS_TABLE: 't' })).toBeInstanceOf(
      DynamoDonationRepository,
    );
  });
});
