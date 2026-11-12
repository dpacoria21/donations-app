import {
  IsAuthorizedCommand,
  VerifiedPermissionsClient,
  type EntityItem,
} from '@aws-sdk/client-verifiedpermissions';
import { forbidden } from '../shared/errors.ts';
import { SCOPES, type Identity } from './identity.ts';

/**
 * Policy Decision Point (PE de NIST SP 800-207, AD-08). Decide si una identidad verificada puede
 * hacer una acción sobre un recurso. Hay dos motores intercambiables:
 *
 * - `embedded` (MVP): RBAC + ownership en código.
 * - `verified-permissions` (HU-12): Amazon Verified Permissions evalúa las políticas Cedar de
 *   `policies/` con `IsAuthorized`.
 *
 * Ambos aplican las mismas reglas de HU-04, HU-07 y HU-08; las pruebas lo comprueban.
 */
export type AuthzAction =
  // HU-04 y HU-08: gestión de proyectos (solo GESTOR).
  | 'ListManagedProjects'
  | 'CreateProject'
  | 'UpdateProject'
  | 'PublishProject'
  // HU-07: historial propio (solo DONANTE) y una donación concreta (solo su propietario).
  | 'ReadOwnDonations'
  | 'ReadDonation';

/** Recurso de la decisión: la plataforma, un proyecto o una donación con su propietario. */
export type AuthzResource =
  | { type: 'Platform' }
  | { type: 'Project'; id: string }
  | { type: 'Donation'; id: string; ownerSub: string };

export interface AuthzRequest {
  identity: Identity;
  action: AuthzAction;
  resource: AuthzResource;
}

export interface PolicyDecisionPoint {
  readonly engine: AuthzEngine;
  isAuthorized(request: AuthzRequest): Promise<boolean>;
}

export const AUTHZ_ENGINES = ['embedded', 'verified-permissions'] as const;
export type AuthzEngine = (typeof AUTHZ_ENGINES)[number];

/** Identificadores Cedar (namespace `Donations`, ver policies/schema.cedarschema.json). */
export const CEDAR_NAMESPACE = 'Donations';
export const PLATFORM_ID = 'donations';

/** Scope que exige cada acción, además del rol (defensa en profundidad con el JWT authorizer). */
const REQUIRED_SCOPE: Record<AuthzAction, string> = {
  ListManagedProjects: SCOPES.projectsWrite,
  CreateProject: SCOPES.projectsWrite,
  UpdateProject: SCOPES.projectsWrite,
  PublishProject: SCOPES.projectsWrite,
  ReadOwnDonations: SCOPES.donationsRead,
  ReadDonation: SCOPES.donationsRead,
};

/** MVP: las reglas en código. Es la referencia que las políticas Cedar deben igualar. */
export class EmbeddedPdp implements PolicyDecisionPoint {
  readonly engine = 'embedded';

  isAuthorized({ identity, action, resource }: AuthzRequest): Promise<boolean> {
    const hasScope = identity.scopes.includes(REQUIRED_SCOPE[action]);
    let allowed: boolean;
    switch (action) {
      case 'ListManagedProjects':
      case 'CreateProject':
      case 'UpdateProject':
      case 'PublishProject':
        allowed = identity.groups.includes('GESTOR');
        break;
      case 'ReadOwnDonations':
        allowed = identity.groups.includes('DONANTE');
        break;
      case 'ReadDonation':
        allowed =
          identity.groups.includes('DONANTE') &&
          resource.type === 'Donation' &&
          resource.ownerSub === identity.sub;
        break;
    }
    return Promise.resolve(hasScope && allowed);
  }
}

/** Solicitud en términos de Cedar, común a Verified Permissions y a la evaluación local. */
export interface CedarRequest {
  principal: { type: string; id: string };
  action: { type: string; id: string };
  resource: { type: string; id: string };
  context: { scopes: string[] };
  /** Entidades: el usuario con sus roles como padres, los roles y el recurso. */
  entities: {
    uid: { type: string; id: string };
    attrs: Record<string, { type: string; id: string }>;
    parents: { type: string; id: string }[];
  }[];
}

const cedarType = (name: string) => `${CEDAR_NAMESPACE}::${name}`;

/**
 * Traduce la solicitud a Cedar. Los roles salen de `cognito:groups` (claims verificados) y el
 * propietario de la donación, del registro guardado en DynamoDB, nunca del cliente.
 */
export function toCedarRequest({ identity, action, resource }: AuthzRequest): CedarRequest {
  const principal = { type: cedarType('User'), id: identity.sub };
  const roles = identity.groups.map((group) => ({ type: cedarType('Role'), id: group }));
  const target =
    resource.type === 'Platform'
      ? { type: cedarType('Platform'), id: PLATFORM_ID }
      : { type: cedarType(resource.type), id: resource.id };
  const attrs: CedarRequest['entities'][number]['attrs'] =
    resource.type === 'Donation'
      ? { owner: { type: cedarType('User'), id: resource.ownerSub } }
      : {};
  return {
    principal,
    action: { type: cedarType('Action'), id: action },
    resource: target,
    context: { scopes: [...identity.scopes] },
    entities: [
      { uid: principal, attrs: {}, parents: roles },
      ...roles.map((role) => ({ uid: role, attrs: {}, parents: [] })),
      { uid: target, attrs, parents: [] },
    ],
  };
}

/** HU-12: decisión externa con Amazon Verified Permissions (CA-12.1). */
export class VerifiedPermissionsPdp implements PolicyDecisionPoint {
  readonly engine = 'verified-permissions';
  readonly #client: VerifiedPermissionsClient;
  readonly #policyStoreId: string;

  constructor(client: VerifiedPermissionsClient, policyStoreId: string) {
    this.#client = client;
    this.#policyStoreId = policyStoreId;
  }

  /** Si Verified Permissions falla, se propaga el error (500): nunca se permite por defecto. */
  async isAuthorized(request: AuthzRequest): Promise<boolean> {
    const cedar = toCedarRequest(request);
    const entityList: EntityItem[] = cedar.entities.map((entity) => ({
      identifier: { entityType: entity.uid.type, entityId: entity.uid.id },
      attributes: Object.fromEntries(
        Object.entries(entity.attrs).map(([name, ref]) => [
          name,
          { entityIdentifier: { entityType: ref.type, entityId: ref.id } },
        ]),
      ),
      parents: entity.parents.map((parent) => ({ entityType: parent.type, entityId: parent.id })),
    }));
    const { decision } = await this.#client.send(
      new IsAuthorizedCommand({
        policyStoreId: this.#policyStoreId,
        principal: { entityType: cedar.principal.type, entityId: cedar.principal.id },
        action: { actionType: cedar.action.type, actionId: cedar.action.id },
        resource: { entityType: cedar.resource.type, entityId: cedar.resource.id },
        context: {
          contextMap: { scopes: { set: cedar.context.scopes.map((scope) => ({ string: scope })) } },
        },
        entities: { entityList },
      }),
    );
    return decision === 'ALLOW';
  }
}

/**
 * Motor según `AUTHZ_ENGINE` (por defecto `embedded`). Con `verified-permissions` es obligatorio
 * `POLICY_STORE_ID`; un valor desconocido falla en lugar de caer en un motor por defecto.
 */
export function createPdp(env: NodeJS.ProcessEnv = process.env): PolicyDecisionPoint {
  const engine = env.AUTHZ_ENGINE?.trim() || 'embedded';
  if (engine === 'embedded') return new EmbeddedPdp();
  if (engine === 'verified-permissions') {
    const policyStoreId = env.POLICY_STORE_ID?.trim();
    if (!policyStoreId) throw new Error('Falta la variable de entorno POLICY_STORE_ID');
    return new VerifiedPermissionsPdp(new VerifiedPermissionsClient(), policyStoreId);
  }
  throw new Error(`AUTHZ_ENGINE desconocido: ${engine}`);
}

/** Lanza 403 si la decisión es denegar. */
export async function authorize(
  pdp: PolicyDecisionPoint,
  request: AuthzRequest,
  onDeny: () => Error = () => forbidden(),
): Promise<void> {
  if (!(await pdp.isAuthorized(request))) throw onDeny();
}
