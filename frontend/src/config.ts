/** Configuración pública leída de las variables VITE_* (ver `.env.template`). */
const env = import.meta.env;
const withoutTrailingSlash = (value: string | undefined) =>
  (value ?? '').trim().replace(/\/+$/, '');

export interface CognitoConfig {
  /** Emisor OIDC: https://cognito-idp.<región>.amazonaws.com/<userPoolId> */
  authority: string;
  clientId: string;
  /** Dominio del managed login: https://<prefijo>.auth.<región>.amazoncognito.com */
  domain: string;
  redirectUri: string;
  logoutUri: string;
}

const cognito: CognitoConfig = {
  authority: withoutTrailingSlash(env.VITE_COGNITO_AUTHORITY),
  clientId: (env.VITE_COGNITO_CLIENT_ID ?? '').trim(),
  domain: withoutTrailingSlash(env.VITE_COGNITO_DOMAIN),
  redirectUri: (env.VITE_COGNITO_REDIRECT_URI ?? '').trim(),
  logoutUri: (env.VITE_COGNITO_LOGOUT_URI ?? '').trim(),
};

export const config = {
  apiBaseUrl: withoutTrailingSlash(env.VITE_API_BASE_URL) || 'http://127.0.0.1:3000',
  /** `null` si falta alguna variable de Cognito: la SPA funciona sin inicio de sesión. */
  cognito: Object.values(cognito).every(Boolean) ? cognito : null,
} as const;

/**
 * Scopes que pide la SPA. Cognito no los limita por grupo: el backend vuelve a comprobar el
 * grupo en cada solicitud (design.md §4, CA-NF02.2).
 */
export const OIDC_SCOPES = [
  'openid',
  'email',
  'api/projects.write',
  'api/donations.write',
  'api/donations.read',
  'api/audit.read',
].join(' ');
