import { createContext, useContext } from 'react';

export interface SessionUser {
  sub: string;
  email: string | undefined;
  /** Grupos del ID token. Solo para la interfaz: el backend decide los permisos. */
  groups: string[];
  accessToken: string;
}

export interface AuthContextValue {
  /** `false` si faltan las variables VITE_COGNITO_*. */
  configured: boolean;
  status: 'loading' | 'anonymous' | 'authenticated';
  user: SessionUser | null;
  /** Redirige al managed login; al volver, lleva a `returnTo`. */
  login: (returnTo?: string) => Promise<void>;
  /** Procesa `/auth/callback` y devuelve la ruta a la que hay que volver. */
  completeLogin: () => Promise<string>;
  /** Revoca el refresh token, borra los tokens de memoria y cierra la sesión de Cognito. */
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return value;
}
