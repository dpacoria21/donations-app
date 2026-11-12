import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createPreTokenGenerationHandler, MfaRequiredError } from '../src/identity/handlers.ts';

function tokenEvent(
  groups: string[],
  triggerSource: PreTokenGenerationTriggerEvent['triggerSource'] = 'TokenGeneration_HostedAuth',
): PreTokenGenerationTriggerEvent {
  return {
    version: '1',
    region: 'us-east-2',
    userPoolId: 'us-east-2_Prueba',
    userName: 'b1f0c2d3-0000-4000-8000-0000000000aa',
    callerContext: { awsSdkVersion: 'x', clientId: 'cliente' },
    triggerSource,
    request: {
      userAttributes: { email: 'gestor1@example.com' },
      groupConfiguration: { groupsToOverride: groups, iamRolesToOverride: [] },
    },
    response: { claimsOverrideDetails: {} },
  };
}

describe('trigger pre token generation: MFA para roles privilegiados (HU-11)', () => {
  it('T14: un GESTOR sin TOTP no obtiene tokens (CA-11.2)', async () => {
    const handler = createPreTokenGenerationHandler(() => Promise.resolve([]));
    await expect(handler(tokenEvent(['GESTOR']))).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it('un AUDITOR sin TOTP tampoco', async () => {
    const handler = createPreTokenGenerationHandler(() => Promise.resolve([]));
    await expect(handler(tokenEvent(['AUDITOR']))).rejects.toThrow('MFA_REQUERIDO');
  });

  it('el SMS no cuenta: solo TOTP (CA-11.1)', async () => {
    const handler = createPreTokenGenerationHandler(() => Promise.resolve(['SMS_MFA']));
    await expect(handler(tokenEvent(['GESTOR']))).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it('un GESTOR con TOTP activo obtiene sus tokens sin cambios', async () => {
    const handler = createPreTokenGenerationHandler(() => Promise.resolve(['SOFTWARE_TOKEN_MFA']));
    const event = tokenEvent(['GESTOR']);
    await expect(handler(event)).resolves.toBe(event);
  });

  it('también se exige al renovar: desactivar el MFA corta la sesión', async () => {
    const handler = createPreTokenGenerationHandler(() => Promise.resolve([]));
    await expect(
      handler(tokenEvent(['GESTOR'], 'TokenGeneration_RefreshTokens')),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it('un DONANTE no necesita MFA y no se consulta Cognito (MFA opcional)', async () => {
    const lookup = vi.fn(() => Promise.resolve([]));
    const handler = createPreTokenGenerationHandler(lookup);
    const event = tokenEvent(['DONANTE']);
    await expect(handler(event)).resolves.toBe(event);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('un usuario sin grupo puede entrar (así configura su MFA antes de recibir el rol)', async () => {
    const handler = createPreTokenGenerationHandler(() => Promise.resolve([]));
    const event = tokenEvent([]);
    await expect(handler(event)).resolves.toBe(event);
  });
});
