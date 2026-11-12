import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { PROJECT_STATUSES, type Project, type ProjectStatus } from './model.ts';
import type { UpdateProjectInput } from './schemas.ts';
import { SEED_PROJECTS } from './seed.ts';

/** Resultado de una escritura condicionada: o el proyecto actualizado, o el motivo del rechazo. */
export type WriteResult<Reason extends string> =
  { ok: true; project: Project } | { ok: false; reason: 'NOT_FOUND' | Reason };

/** Acceso a datos de proyectos. Los handlers no saben si detrás hay memoria o DynamoDB. */
export interface ProjectRepository {
  listPublished(): Promise<Project[]>;
  /** Todos los proyectos, también los BORRADOR (solo para el GESTOR). */
  listAll(): Promise<Project[]>;
  findById(projectId: string): Promise<Project | undefined>;
  create(project: Project): Promise<void>;
  /** Decisión D2: la meta nunca queda por debajo de lo ya recaudado. */
  update(
    projectId: string,
    changes: UpdateProjectInput,
    now: string,
  ): Promise<WriteResult<'GOAL_BELOW_CONFIRMED'>>;
  /** BORRADOR → PUBLICADO; publicar uno ya publicado se rechaza (CA-08.2). */
  publish(projectId: string, now: string): Promise<WriteResult<'ALREADY_PUBLISHED'>>;
}

const newestFirst = (a: Project, b: Project) => b.createdAt.localeCompare(a.createdAt);

/** Datos de prueba para el desarrollo local y las pruebas automáticas. */
export class InMemoryProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project>;

  constructor(projects: readonly Project[]) {
    this.#projects = new Map(projects.map((project) => [project.projectId, { ...project }]));
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

  create(project: Project): Promise<void> {
    if (this.#projects.has(project.projectId)) {
      return Promise.reject(new Error('El proyecto ya existe'));
    }
    this.#projects.set(project.projectId, { ...project });
    return Promise.resolve();
  }

  update(
    projectId: string,
    changes: UpdateProjectInput,
    now: string,
  ): Promise<WriteResult<'GOAL_BELOW_CONFIRMED'>> {
    const current = this.#projects.get(projectId);
    if (!current) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' });
    if (
      changes.goalAmountCents !== undefined &&
      changes.goalAmountCents < current.confirmedAmountCents
    ) {
      return Promise.resolve({ ok: false, reason: 'GOAL_BELOW_CONFIRMED' });
    }
    // Zod solo deja en `changes` los campos que llegaron en el cuerpo.
    const updated: Project = { ...current, ...changes, updatedAt: now };
    this.#projects.set(projectId, updated);
    return Promise.resolve({ ok: true, project: { ...updated } });
  }

  publish(projectId: string, now: string): Promise<WriteResult<'ALREADY_PUBLISHED'>> {
    const current = this.#projects.get(projectId);
    if (!current) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' });
    if (current.status !== 'BORRADOR') {
      return Promise.resolve({ ok: false, reason: 'ALREADY_PUBLISHED' });
    }
    const published: Project = { ...current, status: 'PUBLICADO', updatedAt: now };
    this.#projects.set(projectId, published);
    return Promise.resolve({ ok: true, project: { ...published } });
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

export class DynamoProjectRepository implements ProjectRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
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

  async findById(projectId: string): Promise<Project | undefined> {
    const { Item } = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { projectId } }),
    );
    return Item ? projectRecordSchema.parse(Item) : undefined;
  }

  async create(project: Project): Promise<void> {
    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: project,
        // Un UUID repetido nunca sobrescribe un proyecto existente.
        ConditionExpression: 'attribute_not_exists(projectId)',
      }),
    );
  }

  /**
   * Una sola escritura condicionada: si en el mismo instante una confirmación sube
   * `confirmedAmountCents`, DynamoDB evalúa la condición contra el valor más reciente.
   */
  async update(
    projectId: string,
    changes: UpdateProjectInput,
    now: string,
  ): Promise<WriteResult<'GOAL_BELOW_CONFIRMED'>> {
    const fields = Object.entries(changes);
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':updatedAt': now };
    const assignments = ['#updatedAt = :updatedAt'];
    for (const [name, value] of fields) {
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
      new UpdateCommand({
        TableName: this.#tableName,
        Key: { projectId },
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
      'GOAL_BELOW_CONFIRMED',
    );
  }

  publish(projectId: string, now: string): Promise<WriteResult<'ALREADY_PUBLISHED'>> {
    return this.#conditionalUpdate(
      new UpdateCommand({
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
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
      'ALREADY_PUBLISHED',
    );
  }

  /** Si la condición falla, `ALL_OLD` distingue «no existe» (sin Item) del otro motivo. */
  async #conditionalUpdate<Reason extends string>(
    command: UpdateCommand,
    reason: Reason,
  ): Promise<WriteResult<Reason>> {
    try {
      const { Attributes } = await this.#client.send(command);
      return { ok: true, project: projectRecordSchema.parse(Attributes) };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      return { ok: false, reason: error.Item ? reason : 'NOT_FOUND' };
    }
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
