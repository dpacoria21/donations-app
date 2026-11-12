import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { DONATION_STATUSES, type Donation } from './model.ts';

/** Acceso a datos de donaciones. La fase 4 añade la creación y la simulación. */
export interface DonationRepository {
  /** Historial de un donante, del más reciente al más antiguo (HU-07). */
  listByDonor(donorSub: string): Promise<Donation[]>;
}

export class InMemoryDonationRepository implements DonationRepository {
  readonly #donations: Donation[];

  constructor(donations: readonly Donation[] = []) {
    this.#donations = donations.map((donation) => ({ ...donation }));
  }

  listByDonor(donorSub: string): Promise<Donation[]> {
    const own = this.#donations
      .filter((donation) => donation.donorSub === donorSub)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((donation) => ({ ...donation }));
    return Promise.resolve(own);
  }
}

/** GSI del historial: partición `donorSub`, orden `createdAt` (design.md §5). */
export const DONATIONS_DONOR_INDEX = 'donorSub-createdAt';

const donationRecordSchema = z.object({
  donationId: z.uuid(),
  projectId: z.uuid(),
  donorSub: z.string().min(1),
  amountCents: z.int().positive(),
  currency: z.literal('PEN'),
  status: z.enum(DONATION_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class DynamoDonationRepository implements DonationRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  /**
   * La partición del GSI es el `sub` del token: es imposible leer donaciones ajenas con esta
   * consulta, aunque el cliente envíe otro identificador (ownership, CA-07.2).
   */
  async listByDonor(donorSub: string): Promise<Donation[]> {
    const donations: Donation[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.#client.send(
        new QueryCommand({
          TableName: this.#tableName,
          IndexName: DONATIONS_DONOR_INDEX,
          KeyConditionExpression: 'donorSub = :donorSub',
          ExpressionAttributeValues: { ':donorSub': donorSub },
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of page.Items ?? []) donations.push(donationRecordSchema.parse(item));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return donations;
  }
}

/** Igual que en proyectos: DynamoDB con `DONATIONS_TABLE`; en Lambda, la tabla es obligatoria. */
export function createDonationRepository(env: NodeJS.ProcessEnv = process.env): DonationRepository {
  const tableName = env.DONATIONS_TABLE?.trim();
  if (tableName) {
    return new DynamoDonationRepository(
      DynamoDBDocumentClient.from(new DynamoDBClient()),
      tableName,
    );
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Falta la variable de entorno DONATIONS_TABLE');
  }
  return new InMemoryDonationRepository();
}

let defaultRepository: DonationRepository | undefined;

export function getDonationRepository(): DonationRepository {
  defaultRepository ??= createDonationRepository();
  return defaultRepository;
}
