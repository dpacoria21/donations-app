import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { PROJECT_STATUSES, type Project } from './model.ts';
import { SEED_PROJECTS } from './seed.ts';

/** Acceso a datos de proyectos. Los handlers no saben si detrás hay memoria o DynamoDB. */
export interface ProjectRepository {
  listPublished(): Promise<Project[]>;
  findById(projectId: string): Promise<Project | undefined>;
}

/** Datos de prueba para el desarrollo local y las pruebas automáticas. */
export class InMemoryProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project>;

  constructor(projects: readonly Project[]) {
    this.#projects = new Map(projects.map((project) => [project.projectId, { ...project }]));
  }

  listPublished(): Promise<Project[]> {
    const published = [...this.#projects.values()]
      .filter((project) => project.status === 'PUBLICADO')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((project) => ({ ...project }));
    return Promise.resolve(published);
  }

  findById(projectId: string): Promise<Project | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(project && { ...project });
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
  async listPublished(): Promise<Project[]> {
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
          ExpressionAttributeValues: { ':status': 'PUBLICADO' },
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of page.Items ?? []) projects.push(projectRecordSchema.parse(item));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return projects;
  }

  async findById(projectId: string): Promise<Project | undefined> {
    const { Item } = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { projectId } }),
    );
    return Item ? projectRecordSchema.parse(Item) : undefined;
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
