import { User } from 'oidc-client-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CognitoConfig } from '../config.ts';
import { buildLogoutUrl, createUserManager, revokeRefreshToken } from './oidc.ts';
import { safeReturnTo, toSessionUser } from './session.ts';

const COGNITO: CognitoConfig = {
  authority: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_Prueba',
  clientId: 'cliente-publico',
  domain: 'https://donaciones-prueba.auth.us-east-2.amazoncognito.com',
  redirectUri: 'http://localhost:5173/auth/callback',
  logoutUri: 'http://localhost:5173/',
};

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('createUserManager', () => {
  it('usa Authorization Code con PKCE, sin secreto (CA-03.1)', () => {
    const { settings } = createUserManager(COGNITO);
    expect(settings.response_type).toBe('code');
    expect(settings.disablePKCE).toBe(false);
    expect(settings.client_secret).toBeUndefined();
    expect(settings.scope.split(' ')).toContain('api/donations.read');
  });

  it('guarda los tokens solo en memoria, no en localStorage ni sessionStorage (CA-NF11.1)', async () => {
    const manager = createUserManager(COGNITO);
    const user = new User({
      access_token: 'access-secreto',
      refresh_token: 'refresh-secreto',
      token_type: 'Bearer',
      profile: { sub: 'u1', iss: COGNITO.authority, aud: COGNITO.clientId, exp: 0, iat: 0 },
      expires_at: Math.floor(Date.now() / 1000) + 900,
    });

    await manager.storeUser(user);

    expect((await manager.getUser())?.access_token).toBe('access-secreto');
    const persisted = [localStorage, sessionStorage]
      .flatMap((storage) =>
        Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '')),
      )
      .join(' ');
    expect(persisted).not.toContain('access-secreto');
    expect(persisted).not.toContain('refresh-secreto');
  });
});

describe('cierre de sesión (CA-03.3)', () => {
  it('revoca el refresh token en /oauth2/revoke con el client_id', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null)));

    await revokeRefreshToken(COGNITO, 'refresh-secreto', fetchMock);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${COGNITO.domain}/oauth2/revoke`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init?.body as URLSearchParams;
    expect(body.get('token')).toBe('refresh-secreto');
    expect(body.get('client_id')).toBe(COGNITO.clientId);
  });

  it('informa si la revocación falla', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 400 })),
    );
    await expect(revokeRefreshToken(COGNITO, 'x', fetchMock)).rejects.toThrow('HTTP 400');
  });

  it('cierra la sesión de managed login con client_id y logout_uri', () => {
    const url = new URL(buildLogoutUrl(COGNITO));
    expect(url.origin + url.pathname).toBe(`${COGNITO.domain}/logout`);
    expect(url.searchParams.get('client_id')).toBe(COGNITO.clientId);
    expect(url.searchParams.get('logout_uri')).toBe(COGNITO.logoutUri);
  });
});

describe('sesión', () => {
  it('toma los grupos del token solo para mostrarlos', () => {
    const user = new User({
      access_token: 'a',
      token_type: 'Bearer',
      profile: {
        sub: 'u1',
        email: 'donante1@example.com',
        'cognito:groups': ['DONANTE'],
        iss: 'x',
        aud: 'y',
        exp: 0,
        iat: 0,
      },
      expires_at: Math.floor(Date.now() / 1000) + 900,
    });
    expect(toSessionUser(user)).toMatchObject({ sub: 'u1', groups: ['DONANTE'] });
  });

  it('un token caducado no es una sesión', () => {
    const user = new User({
      access_token: 'a',
      token_type: 'Bearer',
      profile: { sub: 'u1', iss: 'x', aud: 'y', exp: 0, iat: 0 },
      expires_at: Math.floor(Date.now() / 1000) - 1,
    });
    expect(toSessionUser(user)).toBeNull();
  });

  it('solo vuelve a rutas internas tras el login', () => {
    expect(safeReturnTo({ returnTo: '/cuenta' })).toBe('/cuenta');
    expect(safeReturnTo({ returnTo: '//atacante.example' })).toBe('/cuenta');
    expect(safeReturnTo({ returnTo: 'https://atacante.example' })).toBe('/cuenta');
    expect(safeReturnTo(null)).toBe('/cuenta');
  });
});
