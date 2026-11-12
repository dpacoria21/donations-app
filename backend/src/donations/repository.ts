import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { AuditEvent } from '../audit/model.ts';
import { InMemoryAuditLog } from '../audit/recorder.ts';
import type { ProjectStatus } from '../projects/model.ts';
import { DONATION_STATUSES, type Donation } from './model.ts';
import type { SimulationOutcome } from './schemas.ts';

/** Registro de idempotencia (requirements.md §4, design.md §5). */
export interface IdempotencyRecord {
  /** `donorSub#createDonation#idempotencyKey` */
  pk: string;
  payloadHash: string;
  donationId: string;
  responseStatus: number;
  /** TTL de DynamoDB: segundos desde 1970. */
  expiresAt: number;
  createdAt: string;
}

export interface CreateDonationWrite {
  donation: Donation;
  idempotency: IdempotencyRecord;
  audit: AuditEvent;
}

/**
 * - `CREATED`: se guardaron la clave, la donación y el evento, juntos.
 * - `KEY_IN_USE`: otra solicitud con la misma clave llegó antes (incluso en paralelo).
 * - `PROJECT_NOT_PUBLISHED`: el proyecto dejó de cumplir la condición al escribir.
 */
export type CreateDonationResult = 'CREATED' | 'KEY_IN_USE' | 'PROJECT_NOT_PUBLISHED';

/** Acceso a datos de donaciones. La fase 5 añade la simulación. */
export interface DonationRepository {
  /** Historial de un donante, del más reciente al más antiguo (HU-07). */
  listByDonor(donorSub: string): Promise<Donation[]>;
  findById(donationId: string): Promise<Donation | undefined>;
  findIdempotency(pk: string): Promise<IdempotencyRecord | undefined>;
  /** Un único `TransactWriteItems` condicionado (AD-05, CA-05.4). */
  createWithIdempotency(write: CreateDonationWrite): Promise<CreateDonationResult>;
  /**
   * HU-06: PENDIENTE_SIMULACION → resultado, solo si sigue pendiente y es del `donorSub`. Si se
   * confirma, la misma transacción suma el monto al proyecto (CA-06.2, CA-NF04.2).
   */
  simulate(write: SimulateDonationWrite): Promise<SimulateDonationResult>;
}

export interface SimulateDonationWrite {
  /** La donación tal como se leyó (pendiente). */
  donation: Donation;
  outcome: SimulationOutcome;
  now: string;
  audit: AuditEvent;
}

/** `NOT_PENDING`: otra solicitud la simuló antes o ya no está pendiente (409). */
export type SimulateDonationResult =
  { ok: true; donation: Donation } | { ok: false; reason: 'NOT_PENDING' };

const newestFirst = (a: Donation, b: Donation) => b.createdAt.localeCompare(a.createdAt);

export interface InMemoryDonationOptions {
  /** Estado actual de un proyecto, para imitar el `ConditionCheck` de la transacción. */
  projectStatus?: (projectId: string) => Promise<ProjectStatus | undefined>;
  /** Suma una confirmación al acumulado del proyecto (en memoria, de forma síncrona). */
  addConfirmed?: (projectId: string, amountCents: number) => void;
  auditLog?: InMemoryAuditLog;
}

export class InMemoryDonationRepository implements DonationRepository {
  readonly #donations: Map<string, Donation>;
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #projectStatus: (projectId: string) => Promise<ProjectStatus | undefined>;
  readonly #addConfirmed: (projectId: string, amountCents: number) => void;
  readonly #auditLog: InMemoryAuditLog;

  constructor(donations: readonly Donation[] = [], options: InMemoryDonationOptions = {}) {
    this.#donations = new Map(donations.map((donation) => [donation.donationId, { ...donation }]));
    this.#projectStatus = options.projectStatus ?? (() => Promise.resolve('PUBLICADO'));
    this.#addConfirmed = options.addConfirmed ?? (() => undefined);
    this.#auditLog = options.auditLog ?? new InMemoryAuditLog();
  }

  async simulate(write: SimulateDonationWrite): Promise<SimulateDonationResult> {
    const current = this.#donations.get(write.donation.donationId);
    // Comprobación y cambio sin `await` entre medio: igual que la condición de DynamoDB.
    if (
      current?.status !== 'PENDIENTE_SIMULACION' ||
      current.donorSub !== write.donation.donorSub
    ) {
      return { ok: false, reason: 'NOT_PENDING' };
    }
    const updated: Donation = { ...current, status: write.outcome, updatedAt: write.now };
    this.#donations.set(updated.donationId, updated);
    if (write.outcome === 'CONFIRMADA_SIMULADA') {
      this.#addConfirmed(updated.projectId, updated.amountCents);
    }
    await this.#auditLog.record(write.audit);
    return { ok: true, donation: { ...updated } };
  }

  listByDonor(donorSub: string): Promise<Donation[]> {
    const own = [...this.#donations.values()]
      .filter((donation) => donation.donorSub === donorSub)
      .sort(newestFirst)
      .map((donation) => ({ ...donation }));
    return Promise.resolve(own);
  }

  findById(donationId: string): Promise<Donation | undefined> {
    const donation = this.#donations.get(donationId);
    return Promise.resolve(donation && { ...donation });
  }

  findIdempotency(pk: string): Promise<IdempotencyRecord | undefined> {
    const record = this.#idempotency.get(pk);
    return Promise.resolve(record && { ...record });
  }

  async createWithIdempotency(write: CreateDonationWrite): Promise<CreateDonationResult> {
    const status = await this.#projectStatus(write.donation.projectId);
    // Desde aquí no hay `await` hasta escribir: dos solicitudes simultáneas no se intercalan.
    if (this.#idempotency.has(write.idempotency.pk)) return 'KEY_IN_USE';
    if (status !== 'PUBLICADO') return 'PROJECT_NOT_PUBLISHED';
    this.#idempotency.set(write.idempotency.pk, { ...write.idempotency });
    this.#donations.set(write.donation.donationId, { ...write.donation });
    await this.#auditLog.record(write.audit);
    return 'CREATED';
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

const idempotencyRecordSchema = z.object({
  pk: z.string().min(1),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  donationId: z.uuid(),
  responseStatus: z.int(),
  expiresAt: z.int(),
  createdAt: z.iso.datetime(),
});

export interface DynamoDonationTables {
  donations: string;
  /** Solo los necesita la función que crea donaciones. */
  idempotency?: string;
  projects?: string;
  audit?: string;
}

export class DynamoDonationRepository implements DonationRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tables: DynamoDonationTables;

  constructor(client: DynamoDBDocumentClient, tables: DynamoDonationTables | string) {
    this.#client = client;
    this.#tables = typeof tables === 'string' ? { donations: tables } : tables;
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
          TableName: this.#tables.donations,
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

  /** Lectura consistente: tras crear una donación, la respuesta repetida debe encontrarla. */
  async findById(donationId: string): Promise<Donation | undefined> {
    const { Item } = await this.#client.send(
      new GetCommand({
        TableName: this.#tables.donations,
        Key: { donationId },
        ConsistentRead: true,
      }),
    );
    return Item ? donationRecordSchema.parse(Item) : undefined;
  }

  async findIdempotency(pk: string): Promise<IdempotencyRecord | undefined> {
    const { Item } = await this.#client.send(
      new GetCommand({
        TableName: this.#required('idempotency'),
        Key: { pk },
        ConsistentRead: true,
      }),
    );
    return Item ? idempotencyRecordSchema.parse(Item) : undefined;
  }

  /**
   * Clave, donación, comprobación del proyecto y auditoría en **una sola** transacción
   * (AD-05): o se escriben todas o ninguna. La condición `attribute_not_exists(pk)` hace que de
   * dos solicitudes simultáneas con la misma clave solo una cree la donación (CA-05.4).
   */
  async createWithIdempotency(write: CreateDonationWrite): Promise<CreateDonationResult> {
    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.#required('idempotency'),
                Item: write.idempotency,
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: this.#tables.donations,
                Item: write.donation,
                ConditionExpression: 'attribute_not_exists(donationId)',
              },
            },
            {
              // Solo se dona a proyectos PUBLICADO, verificado en la misma transacción.
              ConditionCheck: {
                TableName: this.#required('projects'),
                Key: { projectId: write.donation.projectId },
                ConditionExpression: '#status = :published',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':published': 'PUBLICADO' satisfies ProjectStatus },
              },
            },
            {
              Put: {
                TableName: this.#required('audit'),
                Item: write.audit,
                ConditionExpression: 'attribute_not_exists(eventType)',
              },
            },
          ],
        }),
      );
      return 'CREATED';
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;
      const reasons = error.CancellationReasons ?? [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') return 'KEY_IN_USE';
      if (reasons[2]?.Code === 'ConditionalCheckFailed') return 'PROJECT_NOT_PUBLISHED';
      throw error;
    }
  }

  /**
   * Una sola transacción (CA-NF04.2): la donación cambia solo si sigue PENDIENTE_SIMULACION y es
   * del `donorSub`; si se confirma, `ADD` suma el monto al proyecto; y se guarda el evento. Si
   * llegan 10 confirmaciones a la vez, DynamoDB acepta solo la primera: las demás fallan la
   * condición y no suman nada (CA-06.2, T08). Un rechazo no toca el proyecto (CA-06.3).
   */
  async simulate(write: SimulateDonationWrite): Promise<SimulateDonationResult> {
    const { donation, outcome, now } = write;
    const items: NonNullable<
      ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
    > = [
      {
        Update: {
          TableName: this.#tables.donations,
          Key: { donationId: donation.donationId },
          UpdateExpression: 'SET #status = :outcome, updatedAt = :now',
          ConditionExpression: '#status = :pending AND donorSub = :sub',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':outcome': outcome,
            ':pending': 'PENDIENTE_SIMULACION',
            ':sub': donation.donorSub,
            ':now': now,
          },
        },
      },
    ];
    if (outcome === 'CONFIRMADA_SIMULADA') {
      items.push({
        Update: {
          TableName: this.#required('projects'),
          Key: { projectId: donation.projectId },
          UpdateExpression: 'ADD confirmedAmountCents :amount',
          ConditionExpression: 'attribute_exists(projectId)',
          ExpressionAttributeValues: { ':amount': donation.amountCents },
        },
      });
    }
    items.push({
      Put: {
        TableName: this.#required('audit'),
        Item: write.audit,
        ConditionExpression: 'attribute_not_exists(eventType)',
      },
    });

    try {
      await this.#client.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed'
      ) {
        return { ok: false, reason: 'NOT_PENDING' };
      }
      throw error;
    }
    return { ok: true, donation: { ...donation, status: outcome, updatedAt: now } };
  }

  #required(table: 'idempotency' | 'projects' | 'audit'): string {
    const name = this.#tables[table];
    const variable = {
      idempotency: 'IDEMPOTENCY_TABLE',
      projects: 'PROJECTS_TABLE',
      audit: 'AUDIT_EVENTS_TABLE',
    }[table];
    if (!name) throw new Error(`Falta la variable de entorno ${variable}`);
    return name;
  }
}

/** Igual que en proyectos: DynamoDB con `DONATIONS_TABLE`; en Lambda, la tabla es obligatoria. */
export function createDonationRepository(
  env: NodeJS.ProcessEnv = process.env,
  inMemory: InMemoryDonationOptions = {},
): DonationRepository {
  const tableName = env.DONATIONS_TABLE?.trim();
  if (tableName) {
    const optional = (value: string | undefined) => value?.trim() || undefined;
    return new DynamoDonationRepository(DynamoDBDocumentClient.from(new DynamoDBClient()), {
      donations: tableName,
      idempotency: optional(env.IDEMPOTENCY_TABLE),
      projects: optional(env.PROJECTS_TABLE),
      audit: optional(env.AUDIT_EVENTS_TABLE),
    });
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Falta la variable de entorno DONATIONS_TABLE');
  }
  return new InMemoryDonationRepository([], inMemory);
}

let defaultRepository: DonationRepository | undefined;

export function getDonationRepository(inMemory: InMemoryDonationOptions = {}): DonationRepository {
  defaultRepository ??= createDonationRepository(process.env, inMemory);
  return defaultRepository;
}
