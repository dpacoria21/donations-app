import type { User, UserManager } from 'oidc-client-ts';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { config, type CognitoConfig } from '../config.ts';
import { AuthContext, type AuthContextValue, type SessionUser } from './context.ts';
import { buildLogoutUrl, createUserManager, revokeRefreshToken } from './oidc.ts';
import { safeReturnTo, toSessionUser, type LoginState } from './session.ts';

interface AuthProviderProps {
  children: ReactNode;
  /** Configuración de Cognito; por defecto, la de las variables VITE_COGNITO_*. */
  cognito?: CognitoConfig | null;
  /** Para pruebas: un UserManager ya creado. */
  manager?: UserManager | null;
}

export function AuthProvider({ children, cognito = config.cognito, manager }: AuthProviderProps) {
  const userManager = useMemo(
    () => manager ?? (cognito ? createUserManager(cognito) : null),
    [manager, cognito],
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>(
    userManager ? 'loading' : 'anonymous',
  );
  // StrictMode ejecuta los efectos dos veces; el código de autorización solo se canjea una vez.
  const pendingCallback = useRef<Promise<string> | null>(null);

  const apply = useCallback((loaded: User | null) => {
    const session = toSessionUser(loaded);
    setUser(session);
    setStatus(session ? 'authenticated' : 'anonymous');
  }, []);

  useEffect(() => {
    if (!userManager) return;
    const { events } = userManager;
    void userManager.getUser().then(apply);
    const unsubscribe = [
      events.addUserLoaded(apply),
      events.addUserUnloaded(() => {
        apply(null);
      }),
      // Si la renovación falla y el access token expira, la sesión termina.
      events.addAccessTokenExpired(() => {
        void userManager.removeUser();
      }),
    ];
    return () => {
      for (const remove of unsubscribe) remove();
    };
  }, [userManager, apply]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: userManager !== null,
      status,
      user,
      login: async (returnTo = '/cuenta') => {
        if (!userManager) return;
        const state: LoginState = { returnTo };
        await userManager.signinRedirect({ state });
      },
      completeLogin: () => {
        if (!userManager) return Promise.reject(new Error('Cognito no está configurado'));
        pendingCallback.current ??= userManager
          .signinRedirectCallback()
          .then((loaded) => safeReturnTo(loaded.state));
        return pendingCallback.current;
      },
      logout: async () => {
        if (!userManager || !cognito) return;
        const current = await userManager.getUser();
        if (current?.refresh_token) {
          try {
            await revokeRefreshToken(cognito, current.refresh_token);
          } catch (error) {
            // Se cierra la sesión igualmente; el refresh token caduca en 12 h.
            console.warn('No se pudo revocar el refresh token', error);
          }
        }
        await userManager.removeUser();
        window.location.assign(buildLogoutUrl(cognito));
      },
    }),
    [userManager, cognito, status, user],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
