import { config } from '../config.ts';

/** Error HTTP del API. `status` permite distinguir 400, 401, 403, 404 y 409 en la interfaz. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  accessToken?: string;
  signal?: AbortSignal;
  body?: unknown;
  /** Cabeceras adicionales, por ejemplo `Idempotency-Key`. */
  headers?: Record<string, string>;
}

/**
 * Llamada al API. El access token viaja solo en la cabecera `Authorization` (design.md §4); la
 * interfaz no decide permisos: si el backend responde 401/403, se muestra tal cual.
 */
async function request<T>(method: string, path: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers,
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let message = `HTTP ${String(response.status)}`;
    try {
      // Tanto el formato `Error` del backend como el nativo de API Gateway traen `message`.
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Respuesta sin JSON: se usa el código HTTP.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function getJson<T>(
  path: string,
  options: { accessToken?: string; signal?: AbortSignal } = {},
): Promise<T> {
  return request<T>('GET', path, options);
}

export function sendJson<T>(
  method: 'POST' | 'PATCH',
  path: string,
  options: { accessToken: string; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
  return request<T>(method, path, options);
}
