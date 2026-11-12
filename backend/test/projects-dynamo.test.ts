import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectRepository,
  DynamoProjectRepository,
  InMemoryProjectRepository,
  PROJECTS_STATUS_INDEX,
} from '../src/projects/repository.ts';
import type { Project } from '../src/projects/model.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';

const TABLE = 'ProjectsTable-test';
const ddb = mockClient(DynamoDBDocumentClient);
// El cliente nunca llega a la red: aws-sdk-client-mock intercepta `send`.
const repository = new DynamoProjectRepository(
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
  TABLE,
);

function publishedSeed(index: number): Project {
  const project = SEED_PROJECTS.filter((p) => p.status === 'PUBLICADO')[index];
  if (!project) throw new Error(`No hay proyecto publicado en la posición ${String(index)}`);
  return project;
}
const first = publishedSeed(0);
const second = publishedSeed(1);
const third = publishedSeed(2);

beforeEach(() => {
  ddb.reset();
});

describe('DynamoProjectRepository.listPublished', () => {
  it('consulta el GSI status-createdAt solo por PUBLICADO, del más reciente al más antiguo', async () => {
    ddb.on(QueryCommand).resolves({ Items: [third, second] });

    const projects = await repository.listPublished();

    expect(projects).toEqual([third, second]);
    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      TableName: TABLE,
      IndexName: PROJECTS_STATUS_INDEX,
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'PUBLICADO' },
      ScanIndexForward: false,
    });
  });

  it('recorre todas las páginas del resultado', async () => {
    const lastKey = { projectId: second.projectId, status: 'PUBLICADO' };
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [third], LastEvaluatedKey: lastKey })
      .resolvesOnce({ Items: [second, first] });

    const projects = await repository.listPublished();

    expect(projects.map((project) => project.projectId)).toEqual(
      [third, second, first].map((project) => project.projectId),
    );
    expect(ddb.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  it('descarta atributos que no forman parte del modelo', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...first, internalNote: 'no exponer' }] });

    const [project] = await repository.listPublished();

    expect(project).not.toHaveProperty('internalNote');
  });

  it('rechaza un registro con montos no enteros (AD-04)', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...first, confirmedAmountCents: 10.5 }] });

    await expect(repository.listPublished()).rejects.toThrow();
  });
});

describe('DynamoProjectRepository.findById', () => {
  it('lee el proyecto por su clave primaria', async () => {
    ddb.on(GetCommand).resolves({ Item: first });

    await expect(repository.findById(first.projectId)).resolves.toEqual(first);
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input).toEqual({
      TableName: TABLE,
      Key: { projectId: first.projectId },
      // Las lecturas públicas no necesitan lectura consistente (cuesta el doble).
      ConsistentRead: false,
    });
  });

  it('devuelve undefined si el proyecto no existe', async () => {
    ddb.on(GetCommand).resolves({});

    await expect(repository.findById(first.projectId)).resolves.toBeUndefined();
  });
});

describe('createProjectRepository', () => {
  it('usa DynamoDB cuando PROJECTS_TABLE está definida', () => {
    expect(createProjectRepository({ PROJECTS_TABLE: TABLE })).toBeInstanceOf(
      DynamoProjectRepository,
    );
  });

  it('usa los datos en memoria en desarrollo local sin tabla', () => {
    expect(createProjectRepository({ PROJECTS_TABLE: ' ' })).toBeInstanceOf(
      InMemoryProjectRepository,
    );
  });

  it('falla en Lambda si falta la tabla, en lugar de servir datos ficticios', () => {
    expect(() => createProjectRepository({ AWS_LAMBDA_FUNCTION_NAME: 'list-projects' })).toThrow(
      'PROJECTS_TABLE',
    );
  });
});
