import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuditHandlers } from '../src/audit/handlers.ts';
import { InMemoryAuditReader } from '../src/audit/reader.ts';
import { InMemoryAuditLog } from '../src/audit/recorder.ts';
import { createDonationHandlers } from '../src/donations/handlers.ts';
import { InMemoryDonationRepository } from '../src/donations/repository.ts';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import { DynamoProjectRepository, InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import { donorClaims, httpEvent, jwtEvent } from './helpers/events.ts';
import { jsonBody, managerClaims, PUBLISHED_ID, setupProjects } from './helpers/projects.ts';

/** Error tal como lo lanza el SDK cuando IAM niega la acción. */
function accessDenied(): Error {
  const error = new Error(
    'User: arn:aws:sts::123456789012:assumed-role/ListProjectsRole/fn is not authorized to ' +
      'perform: dynamodb:PutItem on resource: arn:aws:dynamodb:us-east-2:123456789012:table/Projects',
  );
  error.name = 'AccessDeniedException';
  return error;
}

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const capture = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('T10: una función sin permiso responde con un error controlado (CA-NF03.1)', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const handlers = createProjectHandlers(
    new DynamoProjectRepository(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' })),
      'Projects',
    ),
  );

  beforeEach(() => {
    ddb.reset();
  });

  it('AccessDenied de IAM → 500 genérico, sin ARN, cuenta ni acción en la respuesta', async () => {
    ddb.on(QueryCommand).rejects(accessDenied());

    const result = await handlers.listProjects(httpEvent({ requestId: 'req-t10' }));

    expect(result.statusCode).toBe(500);
    expect(jsonBody(result)).toEqual({
      code: 'INTERNAL',
      message: 'Error interno',
      requestId: 'req-t10',
    });
    expect(result.body).not.toMatch(/arn:|123456789012|dynamodb|AccessDenied/);
  });

  it('el log registra el tipo de error para investigarlo, pero no el mensaje con el ARN', async () => {
    ddb.on(QueryCommand).rejects(accessDenied());
    await handlers.listProjects(httpEvent({ requestId: 'req-t10' }));

    const line = JSON.parse(logs.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'error',
      requestId: 'req-t10',
      action: 'projects.list',
      outcome: 'error',
      statusCode: 500,
      errorName: 'AccessDeniedException',
    });
    expect(logs.join('\n')).not.toContain('arn:');
  });
});

describe('logs sin tokens, cuerpos ni datos personales (CA-NF01.2, CA-NF07.1)', () => {
  const TOKEN = 'eyJraWQiOiJ0ZXN0IiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLWRlLXBydWViYQ';
  const EMAIL = 'donante1@example.com';
  const SECRET_BODY = 'texto-del-cuerpo-que-no-debe-registrarse';

  /** Evento con el token en la cabecera, un correo en los claims y un cuerpo identificable. */
  function sensitive(claims: Record<string, string>, body: unknown, pathParameters = {}) {
    const event = jwtEvent({ ...claims, email: EMAIL, username: EMAIL });
    return {
      ...event,
      headers: { authorization: `Bearer ${TOKEN}`, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
      pathParameters,
    };
  }

  it('ninguna ruta escribe el token, el correo, el sub ni el cuerpo en los logs', async () => {
    const { handlers: projects } = setupProjects();
    const auditLog = new InMemoryAuditLog();
    const donations = createDonationHandlers(new InMemoryDonationRepository([], { auditLog }), {
      projects: () => new InMemoryProjectRepository(SEED_PROJECTS),
      auditRecorder: () => auditLog,
      pseudonymKey: () => 'clave-de-prueba',
    });
    const donor = donorClaims();
    const manager = managerClaims();

    await projects.createProject(
      sensitive(manager, { title: SECRET_BODY, description: SECRET_BODY, goalAmountCents: 100 }),
    );
    await projects.createProject(sensitive(donor, { title: SECRET_BODY }));
    await projects.updateProject(
      sensitive(manager, { title: SECRET_BODY }, { projectId: PUBLISHED_ID }),
    );
    await donations.createDonation(
      sensitive(donor, { projectId: PUBLISHED_ID, amountCents: 2_500, note: SECRET_BODY }),
    );
    await donations.createDonation(
      sensitive(donor, { projectId: PUBLISHED_ID, amountCents: 2_500 }),
    );
    await donations.getMyDonations(sensitive(donor, {}));
    await donations.getMyDonations(sensitive(manager, {}));

    expect(logs.length).toBeGreaterThanOrEqual(7);
    const all = logs.join('\n');
    for (const forbidden of [TOKEN, 'eyJ', 'Bearer', EMAIL, donor.sub, manager.sub, SECRET_BODY]) {
      expect(all).not.toContain(forbidden);
    }
    // Cada línea es JSON con requestId, acción, resultado, código HTTP y duración (CA-NF07.1).
    for (const line of logs) {
      expect(JSON.parse(line)).toMatchObject({
        requestId: expect.any(String) as string,
        action: expect.any(String) as string,
        outcome: expect.any(String) as string,
        statusCode: expect.any(Number) as number,
        durationMs: expect.any(Number) as number,
      });
    }
  });
});

describe('la interfaz no autoriza: el API decide en cada solicitud (CA-NF02.2, design.md §9)', () => {
  // Tokens de cada rol con TODOS los scopes: aunque el cliente pida scopes de más (Cognito no
  // los limita por grupo), Lambda exige el grupo correcto.
  const ALL_SCOPES = 'api/projects.write api/donations.write api/donations.read api/audit.read';
  const ROLES = {
    DONANTE: donorClaims({ scope: ALL_SCOPES }),
    GESTOR: managerClaims({ scope: ALL_SCOPES }),
    AUDITOR: donorClaims({
      sub: 'c3d4e5f6-0000-4000-8000-0000000000cc',
      'cognito:groups': '[AUDITOR]',
      scope: ALL_SCOPES,
    }),
    'sin grupo': donorClaims({ 'cognito:groups': '[]', scope: ALL_SCOPES }),
  };
  type Role = keyof typeof ROLES;

  function handlers() {
    const auditLog = new InMemoryAuditLog();
    const { handlers: projects } = setupProjects();
    const donations = createDonationHandlers(new InMemoryDonationRepository([], { auditLog }), {
      projects: () => new InMemoryProjectRepository(SEED_PROJECTS),
      auditRecorder: () => auditLog,
      pseudonymKey: () => 'clave-de-prueba',
    });
    const audit = createAuditHandlers({ reader: () => new InMemoryAuditReader(auditLog) });
    return { projects, donations, audit };
  }

  const call = (claims: Record<string, string>, body?: unknown, pathParameters = {}) => ({
    ...jwtEvent(claims),
    headers: { 'idempotency-key': '9b2f4c1e-7a3d-4e5f-8a6b-1c2d3e4f5a6b' },
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters,
  });

  /** Ruta → único rol permitido. Los demás roles deben recibir 403. */
  const ROUTES: [
    string,
    Role,
    (
      h: ReturnType<typeof handlers>,
      claims: Record<string, string>,
    ) => Promise<{ statusCode?: number }>,
  ][] = [
    [
      'POST /v1/projects',
      'GESTOR',
      (h, c) =>
        h.projects.createProject(
          call(c, {
            title: 'Proyecto nuevo',
            description: 'Descripción suficiente',
            goalAmountCents: 1000,
          }),
        ),
    ],
    [
      'PATCH /v1/projects/{id}',
      'GESTOR',
      (h, c) =>
        h.projects.updateProject(call(c, { title: 'Otro título' }, { projectId: PUBLISHED_ID })),
    ],
    ['GET /v1/manage/projects', 'GESTOR', (h, c) => h.projects.listManagedProjects(call(c))],
    [
      'POST /v1/donations',
      'DONANTE',
      (h, c) => h.donations.createDonation(call(c, { projectId: PUBLISHED_ID, amountCents: 2500 })),
    ],
    ['GET /v1/donations/me', 'DONANTE', (h, c) => h.donations.getMyDonations(call(c))],
    ['GET /v1/audit', 'AUDITOR', (h, c) => h.audit.listAuditEvents(call(c))],
  ];

  for (const [route, allowed, invoke] of ROUTES) {
    it.each(Object.keys(ROLES) as Role[])(`${route}: %s`, async (role) => {
      const result = await invoke(handlers(), ROLES[role]);
      if (role === allowed) expect(result.statusCode).toBeLessThan(300);
      else expect(result.statusCode).toBe(403);
    });
  }

  it.each([
    [
      'crear un proyecto ya PUBLICADO y con recaudado',
      'createProject',
      {
        title: 'Proyecto nuevo',
        description: 'Descripción suficiente',
        goalAmountCents: 1000,
        status: 'PUBLICADO',
        confirmedAmountCents: 999,
      },
    ],
    [
      'editar el monto recaudado o el estado',
      'updateProject',
      { confirmedAmountCents: 1, status: 'PUBLICADO' },
    ],
    [
      'donar en nombre de otro o declarar el rol',
      'createDonation',
      { projectId: PUBLISHED_ID, amountCents: 2500, donorSub: 'otro', groups: ['GESTOR'] },
    ],
  ] as const)('el cliente no puede %s: 400 y sin cambios', async (_case, handler, body) => {
    const h = handlers();
    const claims = handler === 'createDonation' ? ROLES.DONANTE : ROLES.GESTOR;
    const event = call(claims, body, { projectId: PUBLISHED_ID });
    const result =
      handler === 'createDonation'
        ? await h.donations.createDonation(event)
        : await h.projects[handler](event);
    expect(result.statusCode).toBe(400);
  });
});
