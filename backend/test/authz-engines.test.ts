/**
 * HU-12: autorización externalizada con Cedar (CA-12.1, CA-12.2). Las mismas pruebas de
 * autorización (T03, T09, T12 y los casos permitidos) se ejecutan con el PDP embebido y con las
 * políticas Cedar de `policies/`; ambos deben decidir igual.
 */
import {
  VerifiedPermissionsClient,
  IsAuthorizedCommand,
} from '@aws-sdk/client-verifiedpermissions';
import { validate } from '@cedar-policy/cedar-wasm/nodejs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseGroups, parseScopes, type Identity } from '../src/authz/identity.ts';
import {
  createPdp,
  EmbeddedPdp,
  toCedarRequest,
  VerifiedPermissionsPdp,
  type AuthzAction,
  type AuthzResource,
  type PolicyDecisionPoint,
} from '../src/authz/pdp.ts';
import { InMemoryAuditLog } from '../src/audit/recorder.ts';
import { createDonationHandlers } from '../src/donations/handlers.ts';
import type { Donation } from '../src/donations/model.ts';
import { InMemoryDonationRepository } from '../src/donations/repository.ts';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import { InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import { CEDAR_POLICIES, CEDAR_SCHEMA, CedarLocalPdp } from './helpers/cedar.ts';
import { donorClaims, jwtEvent } from './helpers/events.ts';
import {
  DRAFT_ID,
  managedRequest,
  managerClaims,
  NEW_ID,
  NOW,
  PUBLISHED_ID,
  VALID_PROJECT,
} from './helpers/projects.ts';

const DONOR = donorClaims();
const OTHER_DONOR = donorClaims({ sub: 'b1f0c2d3-0000-4000-8000-000000000002' });
const MANAGER = managerClaims();
const AUDITOR = donorClaims({
  sub: 'c3d4e5f6-0000-4000-8000-0000000000cc',
  'cognito:groups': '[AUDITOR]',
  scope: 'openid email api/audit.read api/projects.write api/donations.read',
});
const DONATION: Donation = {
  donationId: '0d6f8a10-0000-4000-8000-000000000001',
  projectId: PUBLISHED_ID,
  donorSub: DONOR.sub ?? '',
  amountCents: 2_500,
  currency: 'PEN',
  status: 'PENDIENTE_SIMULACION',
  createdAt: '2026-11-13T10:00:00.000Z',
  updatedAt: '2026-11-13T10:00:00.000Z',
};

const identityOf = (claims: Record<string, string>): Identity => ({
  sub: claims.sub ?? '',
  groups: parseGroups(claims['cognito:groups']),
  scopes: parseScopes(claims.scope),
});

describe('policies/: esquema y políticas Cedar', () => {
  it('las políticas son válidas contra el esquema en modo estricto', () => {
    const answer = validate({
      schema: CEDAR_SCHEMA,
      policies: { staticPolicies: CEDAR_POLICIES },
      validationSettings: { mode: 'strict' },
    });
    expect(answer.type).toBe('success');
    if (answer.type === 'success') {
      expect(answer.validationErrors).toEqual([]);
      expect(answer.validationWarnings).toEqual([]);
    }
  });

  it('cubre las reglas de HU-04, HU-07 y HU-08 en tres políticas', () => {
    expect(Object.keys(CEDAR_POLICIES)).toEqual([
      'donante-consulta-historial',
      'donante-lee-donacion-propia',
      'gestor-gestiona-proyectos',
    ]);
  });
});

const ENGINES: [string, () => PolicyDecisionPoint][] = [
  ['embebido (MVP)', () => new EmbeddedPdp()],
  ['Cedar (HU-12)', () => new CedarLocalPdp()],
];

describe.each(ENGINES)('PDP %s: matriz de decisiones', (_name, makePdp) => {
  const pdp = makePdp();
  const platform: AuthzResource = { type: 'Platform' };
  const project: AuthzResource = { type: 'Project', id: PUBLISHED_ID };
  const ownDonation: AuthzResource = {
    type: 'Donation',
    id: DONATION.donationId,
    ownerSub: DONOR.sub ?? '',
  };
  const cases: [string, Record<string, string>, AuthzAction, AuthzResource, boolean][] = [
    ['GESTOR lista la gestión', MANAGER, 'ListManagedProjects', platform, true],
    ['GESTOR crea', MANAGER, 'CreateProject', platform, true],
    ['GESTOR edita', MANAGER, 'UpdateProject', project, true],
    ['GESTOR publica', MANAGER, 'PublishProject', project, true],
    ['T03: DONANTE crea', DONOR, 'CreateProject', platform, false],
    ['DONANTE publica', DONOR, 'PublishProject', project, false],
    ['AUDITOR crea, aunque tenga el scope', AUDITOR, 'CreateProject', platform, false],
    [
      'GESTOR sin el scope projects.write',
      managerClaims({ scope: 'openid email' }),
      'CreateProject',
      platform,
      false,
    ],
    ['DONANTE ve su historial', DONOR, 'ReadOwnDonations', platform, true],
    [
      'T12: GESTOR ve historiales',
      managerClaims({ scope: 'api/donations.read' }),
      'ReadOwnDonations',
      platform,
      false,
    ],
    ['AUDITOR ve historiales', AUDITOR, 'ReadOwnDonations', platform, false],
    ['DONANTE lee su donación', DONOR, 'ReadDonation', ownDonation, true],
    ['T09: otro DONANTE lee la donación', OTHER_DONOR, 'ReadDonation', ownDonation, false],
    [
      'DONANTE sin el scope donations.read',
      donorClaims({ scope: 'api/donations.write' }),
      'ReadDonation',
      ownDonation,
      false,
    ],
    ['sin grupos', donorClaims({ 'cognito:groups': '[]' }), 'ReadOwnDonations', platform, false],
  ];

  it.each(cases)('%s → %s', async (_case, claims, action, resource, expected) => {
    await expect(
      pdp.isAuthorized({ identity: identityOf(claims), action, resource }),
    ).resolves.toBe(expected);
  });
});

describe.each(ENGINES)('handlers con el PDP %s (CA-12.2)', (_name, makePdp) => {
  function setup() {
    const auditLog = new InMemoryAuditLog();
    const pdp = makePdp();
    const projects = createProjectHandlers(new InMemoryProjectRepository(SEED_PROJECTS, auditLog), {
      now: () => NOW,
      newId: () => NEW_ID,
      auditRecorder: () => auditLog,
      pseudonymKey: () => 'clave-de-prueba',
      pdp: () => pdp,
    });
    const donations = createDonationHandlers(new InMemoryDonationRepository([DONATION]), {
      pdp: () => pdp,
    });
    return { projects, donations, auditLog };
  }
  const byId = (claims: Record<string, string>, donationId = DONATION.donationId) => ({
    ...jwtEvent(claims),
    pathParameters: { donationId },
  });

  it('T03: un DONANTE no crea proyectos → 403 y queda DENIED en la auditoría', async () => {
    const { projects, auditLog } = setup();
    const result = await projects.createProject(managedRequest(DONOR, { body: VALID_PROJECT }));
    expect(result.statusCode).toBe(403);
    expect(auditLog.events.map((event) => event.outcome)).toEqual(['DENIED']);
  });

  it('un GESTOR crea, edita y publica', async () => {
    const { projects } = setup();
    const created = await projects.createProject(managedRequest(MANAGER, { body: VALID_PROJECT }));
    const updated = await projects.updateProject(
      managedRequest(MANAGER, { projectId: DRAFT_ID, body: { title: 'Título corregido' } }),
    );
    const published = await projects.publishProject(
      managedRequest(MANAGER, { projectId: DRAFT_ID }),
    );
    expect([created.statusCode, updated.statusCode, published.statusCode]).toEqual([201, 200, 200]);
  });

  it('T09: otro DONANTE recibe 404 al pedir una donación ajena', async () => {
    const { donations } = setup();
    expect((await donations.getDonation(byId(OTHER_DONOR))).statusCode).toBe(404);
    expect((await donations.getDonation(byId(DONOR))).statusCode).toBe(200);
  });

  it('T12: un GESTOR no consulta historiales → 403', async () => {
    const { donations } = setup();
    const manager = managerClaims({ scope: 'api/donations.read' });
    expect((await donations.getMyDonations(jwtEvent(manager))).statusCode).toBe(403);
    expect((await donations.getDonation(byId(manager))).statusCode).toBe(403);
  });
});

describe('Amazon Verified Permissions (CA-12.1)', () => {
  const avp = mockClient(VerifiedPermissionsClient);
  const pdp = new VerifiedPermissionsPdp(
    new VerifiedPermissionsClient({ region: 'us-east-2' }),
    'ps-test',
  );
  const request = {
    identity: identityOf(DONOR),
    action: 'ReadDonation' as const,
    resource: { type: 'Donation' as const, id: DONATION.donationId, ownerSub: DONOR.sub ?? '' },
  };

  beforeEach(() => {
    avp.reset();
  });

  it('envía principal, acción, recurso, scopes y entidades a IsAuthorized', async () => {
    avp
      .on(IsAuthorizedCommand)
      .resolves({ decision: 'ALLOW', determiningPolicies: [], errors: [] });

    await expect(pdp.isAuthorized(request)).resolves.toBe(true);

    expect(avp.commandCalls(IsAuthorizedCommand)[0]?.args[0].input).toEqual({
      policyStoreId: 'ps-test',
      principal: { entityType: 'Donations::User', entityId: DONOR.sub },
      action: { actionType: 'Donations::Action', actionId: 'ReadDonation' },
      resource: { entityType: 'Donations::Donation', entityId: DONATION.donationId },
      context: {
        contextMap: {
          scopes: {
            set: [
              { string: 'openid' },
              { string: 'email' },
              { string: 'api/donations.read' },
              { string: 'api/donations.write' },
            ],
          },
        },
      },
      entities: {
        entityList: [
          {
            identifier: { entityType: 'Donations::User', entityId: DONOR.sub },
            attributes: {},
            parents: [{ entityType: 'Donations::Role', entityId: 'DONANTE' }],
          },
          {
            identifier: { entityType: 'Donations::Role', entityId: 'DONANTE' },
            attributes: {},
            parents: [],
          },
          {
            identifier: { entityType: 'Donations::Donation', entityId: DONATION.donationId },
            attributes: {
              owner: { entityIdentifier: { entityType: 'Donations::User', entityId: DONOR.sub } },
            },
            parents: [],
          },
        ],
      },
    });
  });

  it('DENY → no autorizado', async () => {
    avp.on(IsAuthorizedCommand).resolves({ decision: 'DENY', determiningPolicies: [], errors: [] });
    await expect(pdp.isAuthorized(request)).resolves.toBe(false);
  });

  it('si Verified Permissions falla, el handler responde 500: nunca permite por defecto', async () => {
    avp.on(IsAuthorizedCommand).rejects(new Error('ThrottlingException'));
    const { getMyDonations } = createDonationHandlers(new InMemoryDonationRepository([DONATION]), {
      pdp: () => pdp,
    });
    const result = await getMyDonations(jwtEvent(DONOR));
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain(DONATION.donationId);
  });

  it('la traducción a Cedar no usa nada enviado por el cliente: solo claims y el registro', () => {
    const cedar = toCedarRequest(request);
    expect(cedar.entities[0]?.parents).toEqual([{ type: 'Donations::Role', id: 'DONANTE' }]);
    expect(cedar.entities.at(-1)?.attrs.owner).toEqual({ type: 'Donations::User', id: DONOR.sub });
  });
});

describe('createPdp', () => {
  it('por defecto usa el motor embebido', () => {
    expect(createPdp({}).engine).toBe('embedded');
  });

  it('con verified-permissions exige POLICY_STORE_ID', () => {
    expect(() => createPdp({ AUTHZ_ENGINE: 'verified-permissions' })).toThrow('POLICY_STORE_ID');
    expect(
      createPdp({ AUTHZ_ENGINE: 'verified-permissions', POLICY_STORE_ID: 'ps-1' }).engine,
    ).toBe('verified-permissions');
  });

  it('un motor desconocido falla en lugar de elegir uno por defecto', () => {
    expect(() => createPdp({ AUTHZ_ENGINE: 'permitir-todo' })).toThrow('AUTHZ_ENGINE');
  });
});
