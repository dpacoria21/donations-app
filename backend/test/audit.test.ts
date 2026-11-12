import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAuditEvent, getPseudonymKey, pseudonymize } from '../src/audit/model.ts';
import { createAuditRecorder, DynamoAuditRecorder } from '../src/audit/recorder.ts';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import type { Project } from '../src/projects/model.ts';
import { DynamoProjectRepository, InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import { donorClaims } from './helpers/events.ts';
import {
  DRAFT_ID,
  managedRequest as request,
  managerClaims,
  MISSING_ID,
  NEW_ID,
  NOW,
  PSEUDONYM_KEY,
  PUBLISHED_ID,
  setupProjects as setup,
  VALID_PROJECT as VALID,
} from './helpers/projects.ts';

const GESTOR_SUB = managerClaims().sub ?? '';

describe('auditoría de la gestión de proyectos (CA-08.3, CA-10.2)', () => {
  it('crear registra un evento SUCCESS con actor seudonimizado y requestId', async () => {
    const { handlers, auditLog } = setup();
    await handlers.createProject(request(managerClaims(), { body: VALID }));

    expect(auditLog.events).toHaveLength(1);
    const [event] = auditLog.events;
    expect(event).toMatchObject({
      eventType: 'PROJECT_CREATE',
      action: 'projects.create',
      requestId: 'req-test-1',
      actorRef: pseudonymize(GESTOR_SUB, PSEUDONYM_KEY),
      actorRole: 'GESTOR',
      resourceRef: `project/${NEW_ID}`,
      outcome: 'SUCCESS',
      timestamp: NOW,
      sk: `${NOW}#${NEW_ID}`,
    });
  });

  it('el evento no contiene el sub, el título, la descripción ni montos', async () => {
    const { handlers, auditLog } = setup();
    await handlers.createProject(request(managerClaims(), { body: VALID }));
    const serialized = JSON.stringify(auditLog.events);
    for (const value of [GESTOR_SUB, VALID.title, VALID.description, '450000']) {
      expect(serialized).not.toContain(value);
    }
  });

  it('una edición guarda solo los nombres de los campos cambiados, no sus valores', async () => {
    const { handlers, auditLog } = setup();
    await handlers.updateProject(
      request(managerClaims(), {
        projectId: PUBLISHED_ID,
        body: { goalAmountCents: 900_000, title: 'Nuevo título del comedor' },
      }),
    );
    expect(auditLog.events[0]).toMatchObject({
      eventType: 'PROJECT_UPDATE',
      changedFields: ['goalAmountCents', 'title'],
    });
    const serialized = JSON.stringify(auditLog.events);
    expect(serialized).not.toContain('900000');
    expect(serialized).not.toContain('Nuevo título');
  });

  it('publicar registra PROJECT_PUBLISH', async () => {
    const { handlers, auditLog } = setup();
    await handlers.publishProject(request(managerClaims(), { projectId: DRAFT_ID }));
    expect(auditLog.events[0]).toMatchObject({
      eventType: 'PROJECT_PUBLISH',
      resourceRef: `project/${DRAFT_ID}`,
      outcome: 'SUCCESS',
    });
  });

  it('T03 queda registrado como DENIED, con el rol del intento', async () => {
    const { handlers, auditLog } = setup();
    await handlers.createProject(
      request(donorClaims({ scope: 'api/projects.write' }), { body: VALID }),
    );
    expect(auditLog.events).toHaveLength(1);
    expect(auditLog.events[0]).toMatchObject({
      eventType: 'PROJECT_CREATE',
      outcome: 'DENIED',
      actorRole: 'DONANTE',
      resourceRef: 'project/-',
    });
  });

  it('un conflicto (publicar dos veces) queda como REJECTED, sin evento SUCCESS', async () => {
    const { handlers, auditLog } = setup();
    await handlers.publishProject(request(managerClaims(), { projectId: PUBLISHED_ID }));
    expect(auditLog.events.map((event) => event.outcome)).toEqual(['REJECTED']);
  });

  it('datos inválidos quedan como REJECTED', async () => {
    const { handlers, auditLog } = setup();
    await handlers.createProject(
      request(managerClaims(), { body: { ...VALID, goalAmountCents: 0.5 } }),
    );
    expect(auditLog.events.map((event) => event.outcome)).toEqual(['REJECTED']);
  });

  it('el mismo usuario conserva su seudónimo; otro usuario tiene uno distinto', async () => {
    const { handlers, auditLog } = setup();
    await handlers.publishProject(request(managerClaims(), { projectId: DRAFT_ID }));
    await handlers.publishProject(request(managerClaims(), { projectId: DRAFT_ID }));
    await handlers.publishProject(
      request(managerClaims({ sub: 'a7c1e2f3-0000-4000-8000-0000000000bb' }), {
        projectId: DRAFT_ID,
      }),
    );
    const [first, second, other] = auditLog.events.map((event) => event.actorRef);
    expect(first).toBe(second);
    expect(other).not.toBe(first);
  });

  it('un 401 no genera evento: no hay identidad verificable', async () => {
    const { handlers, auditLog } = setup();
    await handlers.createProject(request(managerClaims({ token_use: 'id' }), { body: VALID }));
    expect(auditLog.events).toHaveLength(0);
  });

  it('si falla la auditoría de un intento rechazado, la respuesta no cambia', async () => {
    const handlers = createProjectHandlers(new InMemoryProjectRepository(SEED_PROJECTS), {
      auditRecorder: () => ({ record: () => Promise.reject(new Error('tabla no disponible')) }),
      pseudonymKey: () => PSEUDONYM_KEY,
    });
    const result = await handlers.publishProject(
      request(managerClaims(), { projectId: PUBLISHED_ID }),
    );
    expect(result.statusCode).toBe(409);
  });
});

describe('seudónimo del actor', () => {
  it('es estable y no contiene el sub', () => {
    const ref = pseudonymize(GESTOR_SUB, PSEUDONYM_KEY);
    expect(ref).toMatch(/^actor_[A-Za-z0-9_-]{22}$/);
    expect(ref).toBe(pseudonymize(GESTOR_SUB, PSEUDONYM_KEY));
    expect(ref).not.toContain(GESTOR_SUB.slice(0, 8));
  });

  it('cambia con la clave del despliegue', () => {
    expect(pseudonymize(GESTOR_SUB, 'otra-clave')).not.toBe(
      pseudonymize(GESTOR_SUB, PSEUDONYM_KEY),
    );
  });

  it('en Lambda la clave y la tabla son obligatorias', () => {
    const lambda = { AWS_LAMBDA_FUNCTION_NAME: 'create-project' };
    expect(() => getPseudonymKey(lambda)).toThrow('AUDIT_PSEUDONYM_KEY');
    expect(() => createAuditRecorder(lambda)).toThrow('AUDIT_EVENTS_TABLE');
  });
});

describe('DynamoDB: cambio y auditoría en una sola transacción', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' }));
  const repository = new DynamoProjectRepository(client, 'Projects-test', 'Audit-test');
  const stored = SEED_PROJECTS[1] as Project;
  const audit = buildAuditEvent(
    {
      eventType: 'PROJECT_UPDATE',
      action: 'projects.update',
      requestId: 'req-1',
      actorSub: GESTOR_SUB,
      actorRole: 'GESTOR',
      resourceRef: `project/${PUBLISHED_ID}`,
      outcome: 'SUCCESS',
      timestamp: NOW,
    },
    PSEUDONYM_KEY,
  );
  const canceled = (projectItem?: Record<string, unknown>) =>
    new TransactionCanceledException({
      message: 'Transaction cancelled',
      $metadata: {},
      CancellationReasons: [
        { Code: 'ConditionalCheckFailed', ...(projectItem ? { Item: projectItem as never } : {}) },
        { Code: 'None' },
      ],
    });
  const transactItems = () =>
    ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];

  beforeEach(() => {
    ddb.reset();
  });

  it('crear guarda el proyecto y su evento juntos, sin sobrescribir ninguno', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repository.create({ ...stored, projectId: NEW_ID }, audit);

    const [project, event] = transactItems();
    expect(project?.Put).toMatchObject({
      TableName: 'Projects-test',
      ConditionExpression: 'attribute_not_exists(projectId)',
    });
    expect(event?.Put).toMatchObject({
      TableName: 'Audit-test',
      Item: audit,
      ConditionExpression: 'attribute_not_exists(eventType)',
    });
  });

  it('editar la meta exige, en la misma transacción, que no baje de lo recaudado', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    ddb.on(GetCommand).resolves({ Item: { ...stored, goalAmountCents: 900_000 } });

    const result = await repository.update(PUBLISHED_ID, { goalAmountCents: 900_000 }, NOW, audit);

    expect(result).toMatchObject({ ok: true, project: { goalAmountCents: 900_000 } });
    const [update, event] = transactItems();
    expect(update?.Update?.ConditionExpression).toBe(
      'attribute_exists(projectId) AND #confirmed <= :goalAmountCents',
    );
    expect(update?.Update?.UpdateExpression).toBe(
      'SET #updatedAt = :updatedAt, #goalAmountCents = :goalAmountCents',
    );
    expect(event?.Put?.TableName).toBe('Audit-test');
    // Las transacciones no devuelven el ítem nuevo: se lee con lectura consistente.
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input.ConsistentRead).toBe(true);
  });

  it('si se cancela por la condición y el proyecto existe → GOAL_BELOW_CONFIRMED', async () => {
    ddb.on(TransactWriteCommand).rejects(canceled({ projectId: { S: PUBLISHED_ID } }));
    await expect(
      repository.update(PUBLISHED_ID, { goalAmountCents: 1 }, NOW, audit),
    ).resolves.toEqual({ ok: false, reason: 'GOAL_BELOW_CONFIRMED' });
  });

  it('si se cancela y el proyecto no existe → NOT_FOUND', async () => {
    ddb.on(TransactWriteCommand).rejects(canceled());
    await expect(repository.publish(MISSING_ID, NOW, audit)).resolves.toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('publicar solo cambia BORRADOR → PUBLICADO', async () => {
    ddb.on(TransactWriteCommand).rejects(canceled({ projectId: { S: PUBLISHED_ID } }));
    await expect(repository.publish(PUBLISHED_ID, NOW, audit)).resolves.toEqual({
      ok: false,
      reason: 'ALREADY_PUBLISHED',
    });
    expect(transactItems()[0]?.Update?.ConditionExpression).toBe(
      'attribute_exists(projectId) AND #status = :draft',
    );
  });

  it('otro motivo de cancelación se propaga como error (500 genérico)', async () => {
    ddb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'TransactionConflict' }, { Code: 'None' }],
      }),
    );
    await expect(repository.publish(DRAFT_ID, NOW, audit)).rejects.toThrow();
  });

  it('una función sin tabla de auditoría no puede escribir', async () => {
    const readOnly = new DynamoProjectRepository(client, 'Projects-test');
    await expect(readOnly.publish(DRAFT_ID, NOW, audit)).rejects.toThrow('AUDIT_EVENTS_TABLE');
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('listar todo consulta el GSI por estado, sin Scan', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await repository.listAll();
    const statuses = ddb
      .commandCalls(QueryCommand)
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[':status'] as unknown);
    expect(statuses.sort()).toEqual(['BORRADOR', 'PUBLICADO']);
  });

  it('el registro de intentos fallidos nunca sobrescribe un evento', async () => {
    ddb.on(PutCommand).resolves({});
    await new DynamoAuditRecorder(client, 'Audit-test').record(audit);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input).toMatchObject({
      TableName: 'Audit-test',
      ConditionExpression: 'attribute_not_exists(eventType)',
    });
  });
});
