import { config } from '../config.ts';

/** Error HTTP del API. `status` permite distinguir 401, 403 y 404 en la interfaz. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * GET al API. El access token viaja solo en la cabecera `Authorization` (design.md §4); la
 * interfaz no decide permisos: si el backend responde 401/403, se muestra tal cual.
 */
export async function getJson<T>(
  path: string,
  options: { accessToken?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers,
    signal: options.signal,
  });
  if (!response.ok) {
    let message = `HTTP ${String(response.status)}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Respuesta sin JSON: se usa el código HTTP.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}
