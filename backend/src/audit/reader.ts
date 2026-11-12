import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { AUDIT_EVENT_TYPES, type AuditEvent, type AuditEventType } from './model.ts';
import { localAuditLog, type InMemoryAuditLog } from './recorder.ts';

/** Consulta de HU-10: un tipo (o todos), un rango de fechas y un tamaño de página. */
export interface AuditQuery {
  eventTypes: readonly AuditEventType[];
  /** Límite inferior de `sk` (fecha u hora ISO), incluido. */
  from?: string;
  /** Límite superior (fecha u hora ISO), incluido. */
  to?: string;
  limit: number;
  /** Clave de continuación; solo con un único tipo. */
  cursor?: { eventType: AuditEventType; sk: string };
}

export interface AuditPage {
  items: AuditEvent[];
  /** Hay más resultados del mismo tipo después de esta página. */
  next?: { eventType: AuditEventType; sk: string };
}

export interface AuditReader {
  list(query: AuditQuery): Promise<AuditPage>;
}

/** `sk` es `timestamp#eventId`: con `~` el límite superior incluye todo el día o instante. */
const lowerBound = (from?: string) => from ?? '0';
const upperBound = (to?: string) => `${to ?? '9'}~`;

const auditEventSchema = z.object({
  eventType: z.enum(AUDIT_EVENT_TYPES),
  sk: z.string(),
  eventId: z.string(),
  timestamp: z.string(),
  requestId: z.string(),
  actorRef: z.string(),
  actorRole: z.string().nullable(),
  action: z.string(),
  resourceRef: z.string(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'REJECTED']),
  changedFields: z.array(z.string()).optional(),
});

/** Del más reciente al más antiguo. */
const newestFirst = (a: AuditEvent, b: AuditEvent) => b.sk.localeCompare(a.sk);

/**
 * Lectura de `AuditEvents` (design.md §5): la partición es el tipo y el orden, la fecha. Con un
 * tipo se pagina; sin tipo se consultan los cinco tipos y se devuelven los más recientes.
 */
export class DynamoAuditReader implements AuditReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async list(query: AuditQuery): Promise<AuditPage> {
    const pages = await Promise.all(
      query.eventTypes.map((eventType) =>
        this.#client.send(
          new QueryCommand({
            TableName: this.#tableName,
            KeyConditionExpression: 'eventType = :type AND sk BETWEEN :from AND :to',
            ExpressionAttributeValues: {
              ':type': eventType,
              ':from': lowerBound(query.from),
              ':to': upperBound(query.to),
            },
            ScanIndexForward: false,
            Limit: query.limit,
            ExclusiveStartKey: query.cursor?.eventType === eventType ? query.cursor : undefined,
          }),
        ),
      ),
    );
    const items = pages
      .flatMap((page) => (page.Items ?? []).map((item) => auditEventSchema.parse(item)))
      .sort(newestFirst)
      .slice(0, query.limit);
    const last = pages[0]?.LastEvaluatedKey as AuditPage['next'] | undefined;
    // La continuación solo tiene sentido con un tipo: con varios, se pide filtrar por tipo.
    return query.eventTypes.length === 1 && last ? { items, next: last } : { items };
  }
}

/** Lectura en memoria para desarrollo local y pruebas (mismo orden y filtros). */
export class InMemoryAuditReader implements AuditReader {
  readonly #log: InMemoryAuditLog;

  constructor(log: InMemoryAuditLog) {
    this.#log = log;
  }

  list(query: AuditQuery): Promise<AuditPage> {
    const matching = this.#log.events
      .filter((event) => query.eventTypes.includes(event.eventType))
      .filter((event) => event.sk >= lowerBound(query.from) && event.sk <= upperBound(query.to))
      .filter(
        (event) =>
          !query.cursor || event.eventType !== query.cursor.eventType || event.sk < query.cursor.sk,
      )
      .sort(newestFirst);
    const items = matching.slice(0, query.limit).map((event) => ({ ...event }));
    const last = items.at(-1);
    return Promise.resolve(
      query.eventTypes.length === 1 && matching.length > query.limit && last
        ? { items, next: { eventType: last.eventType, sk: last.sk } }
        : { items },
    );
  }
}

/** DynamoDB con `AUDIT_EVENTS_TABLE`; en local, el registro compartido del servidor. */
export function createAuditReader(env: NodeJS.ProcessEnv = process.env): AuditReader {
  const tableName = env.AUDIT_EVENTS_TABLE?.trim();
  if (tableName) {
    return new DynamoAuditReader(DynamoDBDocumentClient.from(new DynamoDBClient()), tableName);
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Falta la variable de entorno AUDIT_EVENTS_TABLE');
  }
  return new InMemoryAuditReader(localAuditLog);
}
