import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AuditEvent } from './model.ts';

/**
 * Registro de eventos que **no** acompañan a un cambio (intentos denegados o rechazados). Los
 * eventos de éxito se guardan en la misma transacción que el cambio (ver los repositorios).
 */
export interface AuditRecorder {
  record(event: AuditEvent): Promise<void>;
}

/** Memoria compartida: el repositorio en memoria también escribe aquí sus eventos de éxito. */
export class InMemoryAuditLog implements AuditRecorder {
  readonly events: AuditEvent[] = [];

  record(event: AuditEvent): Promise<void> {
    this.events.push({ ...event });
    return Promise.resolve();
  }
}

export class DynamoAuditRecorder implements AuditRecorder {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async record(event: AuditEvent): Promise<void> {
    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: event,
        // Los eventos no se sobrescriben nunca.
        ConditionExpression: 'attribute_not_exists(eventType)',
      }),
    );
  }
}

/**
 * Registro de intentos fallidos: si la auditoría falla, la respuesta al cliente no cambia, pero
 * queda un log de error para detectarlo en CloudWatch.
 */
export async function recordSafely(recorder: AuditRecorder, event: AuditEvent): Promise<void> {
  try {
    await recorder.record(event);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        requestId: event.requestId,
        action: 'audit.record',
        outcome: 'error',
        eventType: event.eventType,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
  }
}

export function createAuditRecorder(env: NodeJS.ProcessEnv = process.env): AuditRecorder {
  const tableName = env.AUDIT_EVENTS_TABLE?.trim();
  if (tableName) {
    return new DynamoAuditRecorder(DynamoDBDocumentClient.from(new DynamoDBClient()), tableName);
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Falta la variable de entorno AUDIT_EVENTS_TABLE');
  }
  return new InMemoryAuditLog();
}
