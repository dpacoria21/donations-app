import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AuthContext, type AuthContextValue, type SessionUser } from '../auth/context.ts';
import { config } from '../config.ts';

export const DONOR: SessionUser = {
  sub: 'b1f0c2d3-0000-4000-8000-000000000001',
  email: 'donante1@example.com',
  groups: ['DONANTE'],
  accessToken: 'access-token-de-prueba',
};

/** Contexto de autenticación falso: las pruebas no hablan con Cognito. */
export function fakeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    configured: true,
    status: 'anonymous',
    user: null,
    login: vi.fn(() => Promise.resolve()),
    completeLogin: vi.fn(() => Promise.resolve('/cuenta')),
    logout: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: {
    route?: string | { pathname: string; state?: unknown };
    auth?: AuthContextValue;
  } = {},
) {
  const auth = options.auth ?? fakeAuth();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext value={auth}>
        <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
      </AuthContext>
    </QueryClientProvider>,
  );
  return { ...result, auth };
}

type RouteHandler = (init: RequestInit | undefined) => Response;

/**
 * Sustituye `fetch` por un API falso con respuestas por ruta, por ejemplo
 * `{ 'GET /v1/projects': () => Response.json({ items: [] }) }`. Cada llamada crea una respuesta
 * nueva (un `Response` solo se puede leer una vez). Una ruta no definida responde 404.
 */
export function mockApi(routes: Record<string, RouteHandler>) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    // Ruta relativa a VITE_API_BASE_URL, que puede incluir el stage (`/academic`).
    const url = input instanceof Request ? input.url : String(input);
    const path = url.slice(config.apiBaseUrl.length).split('?')[0] ?? '';
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    return Promise.resolve(
      handler ? handler(init) : Response.json({ message: 'Not Found' }, { status: 404 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Sustituye `fetch` por una respuesta fija y devuelve el mock para inspeccionar llamadas. */
export function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
