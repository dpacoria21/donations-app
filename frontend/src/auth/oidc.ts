import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { OIDC_SCOPES, type CognitoConfig } from '../config.ts';

/**
 * Cliente OIDC para el managed login de Cognito: Authorization Code + PKCE (CA-03.1).
 *
 * - Los tokens viven solo en memoria (`InMemoryWebStorage`), nunca en `localStorage` ni
 *   `sessionStorage`, para reducir el impacto de un XSS (CA-NF11.1). Al recargar la página la
 *   sesión se pierde y hay que volver a iniciarla.
 * - Lo único que pasa por `sessionStorage` es el estado temporal del login (incluido el
 *   `code_verifier` de PKCE), que se borra al volver del managed login.
 */
export function createUserManager(cognito: CognitoConfig): UserManager {
  return new UserManager({
    authority: cognito.authority,
    client_id: cognito.clientId,
    redirect_uri: cognito.redirectUri,
    post_logout_redirect_uri: cognito.logoutUri,
    response_type: 'code',
    scope: OIDC_SCOPES,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // El access token dura 15 min; se renueva con el refresh token, sin iframes.
    automaticSilentRenew: true,
    loadUserInfo: false,
  });
}

/**
 * Revoca el refresh token en Cognito (`POST /oauth2/revoke`, CA-03.3). Con eso, el refresh token
 * y los access tokens emitidos con él dejan de poder renovarse. Un access token ya emitido
 * sigue siendo aceptado por el JWT authorizer hasta que expira (CA-03.4, T13).
 */
export async function revokeRefreshToken(
  cognito: CognitoConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${cognito.domain}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, client_id: cognito.clientId }),
  });
  if (!response.ok) throw new Error(`La revocación respondió HTTP ${String(response.status)}`);
}

/** Cierra la sesión del managed login; Cognito vuelve después a `logout_uri`. */
export function buildLogoutUrl(cognito: CognitoConfig): string {
  const params = new URLSearchParams({
    client_id: cognito.clientId,
    logout_uri: cognito.logoutUri,
  });
  return `${cognito.domain}/logout?${params.toString()}`;
}
