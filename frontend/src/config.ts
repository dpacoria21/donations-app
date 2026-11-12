/** Configuración pública leída de las variables VITE_* (ver `.env.template`). */
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
} as const;
