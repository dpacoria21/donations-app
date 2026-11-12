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
import { PROJECT_STATUSES, type Project, type ProjectStatus } from './model.ts';
import type { UpdateProjectInput } from './schemas.ts';
import { SEED_PROJECTS } from './seed.ts';

/** Resultado de una escritura condicionada: o el proyecto actualizado, o el motivo del rechazo. */
export type WriteResult<Reason extends string> =
  { ok: true; project: Project } | { ok: false; reason: 'NOT_FOUND' | Reason };

/**
 * Acceso a datos de proyectos. Los handlers no saben si detrás hay memoria o DynamoDB.
 *
 * Cada escritura recibe su evento de auditoría y lo guarda **en la misma transacción** que el
 * cambio: o se guardan ambos o ninguno (CA-08.3). No hay cambios sin rastro.
 */
export interface ProjectRepository {
  listPublished(): Promise<Project[]>;
  /** Todos los proyectos, también los BORRADOR (solo para el GESTOR). */
  listAll(): Promise<Project[]>;
  findById(projectId: string): Promise<Project | undefined>;
  create(project: Project, audit: AuditEvent): Promise<void>;
  /** Decisión D2: la meta nunca queda por debajo de lo ya recaudado. */
  update(
    projectId: string,
    changes: UpdateProjectInput,
    now: string,
    audit: AuditEvent,
  ): Promise<WriteResult<'GOAL_BELOW_CONFIRMED'>>;
  /** BORRADOR → PUBLICADO; publicar uno ya publicado se rechaza (CA-08.2). */
  publish(
    projectId: string,
    now: string,
    audit: AuditEvent,
  ): Promise<WriteResult<'ALREADY_PUBLISHED'>>;
}

const newestFirst = (a: Project, b: Project) => b.createdAt.localeCompare(a.createdAt);

/** Datos de prueba para el desarrollo local y las pruebas automáticas. */
export class InMemoryProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project>;
  readonly #auditLog: InMemoryAuditLog;

  constructor(projects: readonly Project[], auditLog = new InMemoryAuditLog()) {
    this.#projects = new Map(projects.map((project) => [project.projectId, { ...project }]));
    this.#auditLog = auditLog;
  }

  listPublished(): Promise<Project[]> {
    return this.listAll().then((all) => all.filter((project) => project.status === 'PUBLICADO'));
  }

  listAll(): Promise<Project[]> {
    return Promise.resolve(
      [...this.#projects.values()].sort(newestFirst).map((project) => ({ ...project })),
    );
  }

  findById(projectId: string): Promise<Project | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(project && { ...project });
  }

  async create(project: Project, audit: AuditEvent): Promise<void> {
    if (this.#projects.has(project.projectId)) throw new Error('El proyecto ya existe');
    this.#projects.set(project.projectId, { ...project });
    await this.#auditLog.record(audit);
  }

  async update(
    projectId: string,
    changes: UpdateProjectInput,
    now: string,
    audit: AuditEvent,
  ): Promise<WriteResult<'GOAL_BELOW_CONFIRMED'>> {
    const current = this.#projects.get(projectId);
    if (!current) return { ok: false, reason: 'NOT_FOUND' };
    if (
      changes.goalAmountCents !== undefined &&
      changes.goalAmountCents < current.confirmedAmountCents
    ) {
      return { ok: false, reason: 'GOAL_BELOW_CONFIRMED' };
    }
    // Zod solo deja en `changes` los campos que llegaron en el cuerpo.
    const updated: Project = { ...current, ...changes, updatedAt: now };
    this.#projects.set(projectId, updated);
    await this.#auditLog.record(audit);
    return { ok: true, project: { ...updated } };
  }

  async publish(
    projectId: string,
    now: string,
    audit: AuditEvent,
  ): Promise<WriteResult<'ALREADY_PUBLISHED'>> {
    const current = this.#projects.get(projectId);
    if (!current) return { ok: false, reason: 'NOT_FOUND' };
    if (current.status !== 'BORRADOR') return { ok: false, reason: 'ALREADY_PUBLISHED' };
    const published: Project = { ...current, status: 'PUBLICADO', updatedAt: now };
    this.#projects.set(projectId, published);
    await this.#auditLog.record(audit);
    return { ok: true, project: { ...published } };
  }
}

/** GSI del catálogo: partición `status`, orden `createdAt` (design.md §5). */
export const PROJECTS_STATUS_INDEX = 'status-createdAt';

/**
 * Lo que se lee de DynamoDB se valida antes de usarlo: un registro corrupto o con montos no
 * enteros produce un 500 genérico en lugar de llegar al cliente (AD-04). Los atributos que
 * no están en el esquema se descartan.
 */
const projectRecordSchema = z.object({
  projectId: z.uuid(),
  title: z.string().min(1),
  description: z.string(),
  goalAmountCents: z.int().nonnegative(),
  confirmedAmountCents: z.int().nonnegative(),
  currency: z.literal('PEN'),
  status: z.enum(PROJECT_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

type TransactItem = NonNullable<
  ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
>[number];

export class DynamoProjectRepository implements ProjectRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;
  /** Solo lo necesitan las funciones que escriben; las de lectura no tienen acceso a esa tabla. */
  readonly #auditTableName: string | undefined;

  constructor(client: DynamoDBDocumentClient, tableName: string, auditTableName?: string) {
    this.#client = client;
    this.#tableName = tableName;
    this.#auditTableName = auditTableName;
  }

  /** Solo `Query` sobre el GSI: el rol de la Lambda de listado no puede hacer `Scan`. */
  listPublished(): Promise<Project[]> {
    return this.#queryByStatus('PUBLICADO');
  }

  /** Dos consultas al mismo GSI (una por estado), sin `Scan` de la tabla. */
  async listAll(): Promise<Project[]> {
    const [drafts, published] = await Promise.all([
      this.#queryByStatus('BORRADOR'),
      this.#queryByStatus('PUBLICADO'),
    ]);
    return [...drafts, ...published].sort(newestFirst);
  }

  async findById(projectId: string, consistent = false): Promise<Project | undefined> {
    const { Item } = await this.#client.send(
      new GetCommand({
        TableName: this.#tableName,
        Key: { projectId },
        ConsistentRead: consistent,
      }),
    );
    return Item ? projectRecordSchema.parse(Item) : undefined;
  }

  async create(project: Project, audit: AuditEvent): Promise<void> {
    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.#tableName,
              Item: project,
              // Un UUID repetido nunca sobrescribe un proyecto existente.
              ConditionExpression: 'attribute_not_exists(projectId)',
            },
          },
          this.#auditItem(audit),
        ],
      }),
    );
  }

  /**
   * Una sola transacción: si en el mismo instante una confirmación sube
   * `confirmedAmountCents`, DynamoDB evalúa la condición contra el valor más reciente.
   */
  update(
    projectId: string,
    changes: UpdateProjectInput,
    now: string,
    audit: AuditEvent,
  ): Promise<WriteResult<'GOAL_BELOW_CONFIRMED'>> {
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':updatedAt': now };
    const assignments = ['#updatedAt = :updatedAt'];
    for (const [name, value] of Object.entries(changes)) {
      names[`#${name}`] = name;
      values[`:${name}`] = value;
      assignments.push(`#${name} = :${name}`);
    }

    let condition = 'attribute_exists(projectId)';
    if (changes.goalAmountCents !== undefined) {
      names['#confirmed'] = 'confirmedAmountCents';
      condition += ' AND #confirmed <= :goalAmountCents';
    }

    return this.#conditionalUpdate(
      projectId,
      {
        Update: {
          TableName: this.#tableName,
          Key: { projectId },
          UpdateExpression: `SET ${assignments.join(', ')}`,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        },
      },
      audit,
      'GOAL_BELOW_CONFIRMED',
    );
  }

  publish(
    projectId: string,
    now: string,
    audit: AuditEvent,
  ): Promise<WriteResult<'ALREADY_PUBLISHED'>> {
    return this.#conditionalUpdate(
      projectId,
      {
        Update: {
          TableName: this.#tableName,
          Key: { projectId },
          UpdateExpression: 'SET #status = :published, #updatedAt = :now',
          ConditionExpression: 'attribute_exists(projectId) AND #status = :draft',
          ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: {
            ':published': 'PUBLICADO' satisfies ProjectStatus,
            ':draft': 'BORRADOR' satisfies ProjectStatus,
            ':now': now,
          },
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        },
      },
      audit,
      'ALREADY_PUBLISHED',
    );
  }

  #auditItem(audit: AuditEvent): TransactItem {
    if (!this.#auditTableName) throw new Error('Falta la variable de entorno AUDIT_EVENTS_TABLE');
    return {
      Put: {
        TableName: this.#auditTableName,
        Item: audit,
        ConditionExpression: 'attribute_not_exists(eventType)',
      },
    };
  }

  /**
   * Cambio + evento en una transacción. Si se cancela por la condición del proyecto, `ALL_OLD`
   * distingue «no existe» (sin Item) del otro motivo. Las transacciones no devuelven el ítem
   * nuevo, así que se lee con `ConsistentRead` justo después.
   */
  async #conditionalUpdate<Reason extends string>(
    projectId: string,
    update: TransactItem,
    audit: AuditEvent,
    reason: Reason,
  ): Promise<WriteResult<Reason>> {
    try {
      await this.#client.send(
        new TransactWriteCommand({ TransactItems: [update, this.#auditItem(audit)] }),
      );
    } catch (error) {
      const projectCheck =
        error instanceof TransactionCanceledException ? error.CancellationReasons?.[0] : undefined;
      if (projectCheck?.Code !== 'ConditionalCheckFailed') throw error;
      return { ok: false, reason: projectCheck.Item ? reason : 'NOT_FOUND' };
    }
    const project = await this.findById(projectId, true);
    if (!project) throw new Error('El proyecto no se encontró después de actualizarlo');
    return { ok: true, project };
  }

  async #queryByStatus(status: ProjectStatus): Promise<Project[]> {
    const projects: Project[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.#client.send(
        new QueryCommand({
          TableName: this.#tableName,
          IndexName: PROJECTS_STATUS_INDEX,
          // `status` es una palabra reservada de DynamoDB.
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status },
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of page.Items ?? []) projects.push(projectRecordSchema.parse(item));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return projects;
  }
}

/**
 * Con `PROJECTS_TABLE` se usa DynamoDB; sin ella, los datos de prueba en memoria. En Lambda la
 * tabla es obligatoria: una función mal configurada no debe servir datos ficticios en silencio.
 */
export function createProjectRepository(env: NodeJS.ProcessEnv = process.env): ProjectRepository {
  const tableName = env.PROJECTS_TABLE?.trim();
  if (tableName) {
    return new DynamoProjectRepository(
      DynamoDBDocumentClient.from(new DynamoDBClient()),
      tableName,
      env.AUDIT_EVENTS_TABLE?.trim() || undefined,
    );
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Falta la variable de entorno PROJECTS_TABLE');
  }
  return new InMemoryProjectRepository(SEED_PROJECTS);
}

let defaultRepository: ProjectRepository | undefined;

/** Repositorio compartido entre invocaciones de la misma instancia de Lambda. */
export function getProjectRepository(): ProjectRepository {
  defaultRepository ??= createProjectRepository();
  return defaultRepository;
}
