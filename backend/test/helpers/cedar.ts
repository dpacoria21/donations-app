import { readdirSync, readFileSync } from 'node:fs';
import { isAuthorized, type Schema } from '@cedar-policy/cedar-wasm/nodejs';
import {
  toCedarRequest,
  type AuthzRequest,
  type PolicyDecisionPoint,
} from '../../src/authz/pdp.ts';

const POLICIES_DIR = new URL('../../../policies/', import.meta.url);

/** Esquema Cedar de `policies/` (el mismo que la plantilla carga en Verified Permissions). */
export const CEDAR_SCHEMA = JSON.parse(
  readFileSync(new URL('schema.cedarschema.json', POLICIES_DIR), 'utf8'),
) as Schema & Record<string, unknown>;

/** Cada archivo `.cedar` de `policies/`, por nombre. */
export const CEDAR_POLICIES: Record<string, string> = Object.fromEntries(
  readdirSync(POLICIES_DIR)
    .filter((file) => file.endsWith('.cedar'))
    .sort()
    .map((file) => [
      file.replace(/\.cedar$/, ''),
      readFileSync(new URL(file, POLICIES_DIR), 'utf8'),
    ]),
);

/**
 * PDP que evalúa las políticas reales de `policies/` con el motor oficial de Cedar (WebAssembly),
 * con la misma traducción de la solicitud que usa Verified Permissions. Permite comprobar en las
 * pruebas que el motor externo decide igual que el embebido (CA-12.2) sin llamar a AWS.
 */
export class CedarLocalPdp implements PolicyDecisionPoint {
  readonly engine = 'verified-permissions';

  isAuthorized(request: AuthzRequest): Promise<boolean> {
    const cedar = toCedarRequest(request);
    const answer = isAuthorized({
      principal: cedar.principal,
      action: cedar.action,
      resource: cedar.resource,
      context: cedar.context,
      schema: CEDAR_SCHEMA,
      validateRequest: true,
      policies: { staticPolicies: CEDAR_POLICIES },
      entities: cedar.entities.map((entity) => ({
        uid: entity.uid,
        attrs: Object.fromEntries(
          Object.entries(entity.attrs).map(([name, ref]) => [name, { __entity: ref }]),
        ),
        parents: entity.parents,
      })),
    });
    if (answer.type === 'failure') {
      throw new Error(answer.errors.map((error) => error.message).join('; '));
    }
    return Promise.resolve(answer.response.decision === 'allow');
  }
}
