import { describe, expect, it } from 'vitest';
import {
  getIdentity,
  parseGroups,
  parseScopes,
  requireGroup,
  requireScope,
  SCOPES,
} from '../src/authz/identity.ts';
import { AppError } from '../src/shared/errors.ts';
import { donorClaims, httpEvent, jwtEvent } from './helpers/events.ts';

/** Código HTTP del AppError lanzado por `fn`, o undefined si no lanza uno. */
function thrownStatus(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.statusCode;
  }
  return undefined;
}

describe('parseGroups', () => {
  it('lee el formato de texto del JWT authorizer de HTTP API', () => {
    expect(parseGroups('[DONANTE GESTOR]')).toEqual(['DONANTE', 'GESTOR']);
  });

  it('acepta un arreglo real', () => {
    expect(parseGroups(['AUDITOR'])).toEqual(['AUDITOR']);
  });

  it('descarta grupos desconocidos, duplicados y valores vacíos', () => {
    expect(parseGroups('[ADMIN DONANTE DONANTE]')).toEqual(['DONANTE']);
    expect(parseGroups('[]')).toEqual([]);
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups(42)).toEqual([]);
  });
});

describe('parseScopes', () => {
  it('separa el claim scope por espacios', () => {
    expect(parseScopes('openid api/donations.read')).toEqual(['openid', 'api/donations.read']);
  });

  it('sin claim no hay scopes', () => {
    expect(parseScopes(undefined)).toEqual([]);
  });
});

describe('getIdentity (CA-04.3)', () => {
  it('obtiene sub, grupos y scopes de los claims verificados', () => {
    const identity = getIdentity(jwtEvent(donorClaims({ sub: 'user-123' })));
    expect(identity).toEqual({
      sub: 'user-123',
      groups: ['DONANTE'],
      scopes: ['openid', 'email', 'api/donations.read', 'api/donations.write'],
    });
  });

  it('sin grupos, el usuario no tiene roles', () => {
    expect(getIdentity(jwtEvent({ sub: 'user-123', token_use: 'access' })).groups).toEqual([]);
  });

  it('responde 401 si no hay authorizer o falta sub', () => {
    const withoutAuthorizer = httpEvent() as unknown as Parameters<typeof getIdentity>[0];
    for (const event of [withoutAuthorizer, jwtEvent({}), jwtEvent(donorClaims({ sub: '' }))]) {
      expect(thrownStatus(() => getIdentity(event))).toBe(401);
    }
  });

  it('responde 401 con un ID token en lugar de un access token (CA-03.2)', () => {
    expect(thrownStatus(() => getIdentity(jwtEvent(donorClaims({ token_use: 'id' }))))).toBe(401);
    const withoutTokenUse: Record<string, string> = donorClaims();
    delete withoutTokenUse.token_use;
    expect(thrownStatus(() => getIdentity(jwtEvent(withoutTokenUse)))).toBe(401);
  });
});

describe('requireScope', () => {
  const identity = { sub: 'u', groups: [], scopes: ['api/donations.read'] };

  it('permite el acceso con el scope requerido', () => {
    expect(() => {
      requireScope(identity, SCOPES.donationsRead);
    }).not.toThrow();
  });

  it('responde 403 sin el scope', () => {
    expect(
      thrownStatus(() => {
        requireScope(identity, SCOPES.projectsWrite);
      }),
    ).toBe(403);
  });
});

describe('requireGroup (HU-04)', () => {
  it('permite el acceso si el usuario pertenece al grupo', () => {
    expect(() => {
      requireGroup({ sub: 'u', groups: ['GESTOR'], scopes: [] }, 'GESTOR');
    }).not.toThrow();
  });

  it('responde 403 si el usuario no pertenece al grupo', () => {
    expect(
      thrownStatus(() => {
        requireGroup({ sub: 'u', groups: ['DONANTE'], scopes: [] }, 'GESTOR');
      }),
    ).toBe(403);
  });
});
