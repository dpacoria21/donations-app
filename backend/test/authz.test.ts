import { describe, expect, it } from 'vitest';
import { getIdentity, parseGroups, requireGroup } from '../src/authz/identity.ts';
import { AppError } from '../src/shared/errors.ts';
import { httpEvent, jwtEvent } from './helpers/events.ts';

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

describe('getIdentity (CA-04.3)', () => {
  it('obtiene sub y grupos de los claims verificados', () => {
    const identity = getIdentity(jwtEvent({ sub: 'user-123', 'cognito:groups': '[DONANTE]' }));
    expect(identity).toEqual({ sub: 'user-123', groups: ['DONANTE'] });
  });

  it('sin grupos, el usuario no tiene roles', () => {
    expect(getIdentity(jwtEvent({ sub: 'user-123' })).groups).toEqual([]);
  });

  it('responde 401 si no hay authorizer o falta sub', () => {
    const withoutAuthorizer = httpEvent() as unknown as Parameters<typeof getIdentity>[0];
    for (const event of [withoutAuthorizer, jwtEvent({}), jwtEvent({ sub: '' })]) {
      expect(thrownStatus(() => getIdentity(event))).toBe(401);
    }
  });
});

describe('requireGroup (HU-04)', () => {
  it('permite el acceso si el usuario pertenece al grupo', () => {
    expect(() => {
      requireGroup({ sub: 'u', groups: ['GESTOR'] }, 'GESTOR');
    }).not.toThrow();
  });

  it('responde 403 si el usuario no pertenece al grupo', () => {
    expect(
      thrownStatus(() => {
        requireGroup({ sub: 'u', groups: ['DONANTE'] }, 'GESTOR');
      }),
    ).toBe(403);
  });
});
