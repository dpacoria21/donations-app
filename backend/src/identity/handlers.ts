import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';

/** Roles con privilegios que exigen MFA TOTP (HU-11, matriz de roles). */
export const PRIVILEGED_GROUPS = ['GESTOR', 'AUDITOR'] as const;

/** Métodos MFA activos de un usuario, por ejemplo `['SOFTWARE_TOKEN_MFA']`. */
export type MfaLookup = (userPoolId: string, username: string) => Promise<string[]>;

export class MfaRequiredError extends Error {
  constructor() {
    super('MFA_REQUERIDO: las cuentas GESTOR y AUDITOR deben tener una app autenticadora (TOTP).');
    this.name = 'MfaRequiredError';
  }
}

/**
 * Trigger *pre token generation* de Cognito (HU-11, CA-11.1, CA-11.2, decisión D5).
 *
 * Cognito solo permite MFA obligatorio para todo el pool, y la matriz de roles lo pide solo
 * para GESTOR y AUDITOR. Este trigger se ejecuta antes de emitir cualquier token (inicio de
 * sesión y renovación): si el usuario pertenece a un grupo privilegiado y no tiene TOTP
 * activo, lanza un error y Cognito **no emite tokens** (T14). Como también corre al renovar,
 * desactivar el MFA después corta la sesión en la siguiente renovación.
 *
 * Con TOTP activo, Cognito ya exigió el segundo factor antes de llegar aquí (MFA opcional del
 * pool: quien lo activa debe usarlo siempre).
 */
export function createPreTokenGenerationHandler(lookupMfa: MfaLookup) {
  return async (event: PreTokenGenerationTriggerEvent): Promise<PreTokenGenerationTriggerEvent> => {
    const groups = event.request.groupConfiguration.groupsToOverride ?? [];
    const privileged = groups.some((group) =>
      (PRIVILEGED_GROUPS as readonly string[]).includes(group),
    );
    if (!privileged) return event;

    const methods = await lookupMfa(event.userPoolId, event.userName);
    if (methods.includes('SOFTWARE_TOKEN_MFA')) return event;

    // Sin datos personales: solo el resultado y el origen del intento.
    console.log(
      JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        action: 'identity.preTokenGeneration',
        outcome: 'denied',
        reason: 'MFA_REQUIRED',
        triggerSource: event.triggerSource,
      }),
    );
    throw new MfaRequiredError();
  };
}

const cognito = new CognitoIdentityProviderClient();

/** Consulta los métodos MFA del usuario (rol con solo `cognito-idp:AdminGetUser`). */
export const lookupMfaWithCognito: MfaLookup = async (userPoolId, username) => {
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
  );
  return user.UserMFASettingList ?? [];
};

export const preTokenGeneration = createPreTokenGenerationHandler(lookupMfaWithCognito);
