import type { User } from 'oidc-client-ts';
import type { SessionUser } from './context.ts';

export interface LoginState {
  returnTo?: string;
}

/** Datos de la sesión para la interfaz. Un usuario con el token caducado no tiene sesión. */
export function toSessionUser(user: User | null): SessionUser | null {
  if (!user || user.expired) return null;
  const groups = user.profile['cognito:groups'];
  return {
    sub: user.profile.sub,
    email: user.profile.email,
    groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
    accessToken: user.access_token,
  };
}

/** Solo rutas internas: evita redirecciones abiertas a otros sitios tras el login. */
export function safeReturnTo(state: unknown): string {
  const returnTo = (state as LoginState | null)?.returnTo;
  return typeof returnTo === 'string' && /^\/(?!\/)/.test(returnTo) ? returnTo : '/cuenta';
}
