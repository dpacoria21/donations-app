import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import type { AuditEvent } from '../audit/types.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from '../test/render.tsx';
import { AuditPage } from './AuditPage.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUDITOR = { ...DONOR, groups: ['AUDITOR'], accessToken: 'token-auditor' };
const signedInAuditor = () => fakeAuth({ status: 'authenticated', user: AUDITOR });

const PUBLISH: AuditEvent = {
  eventType: 'PROJECT_PUBLISH',
  eventId: '6f1c9a2e-0000-4000-8000-000000000001',
  timestamp: '2026-11-12T15:00:00.000Z',
  requestId: 'GuUxCg5XiYcEM1g=',
  actorRef: 'actor_3QmZ0k1x9aPq2LrT7vWbYc',
  actorRole: 'GESTOR',
  action: 'projects.publish',
  resourceRef: 'project/7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63',
  outcome: 'SUCCESS',
};
const DENIED: AuditEvent = {
  ...PUBLISH,
  eventId: '6f1c9a2e-0000-4000-8000-000000000002',
  eventType: 'PROJECT_CREATE',
  action: 'projects.create',
  actorRole: 'DONANTE',
  outcome: 'DENIED',
};

/** Mock del API que guarda la query string de cada llamada a /v1/audit. */
function auditApi(pages: Record<string, { items: AuditEvent[]; nextCursor?: string }>) {
  const queries: URLSearchParams[] = [];
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    queries.push(url.searchParams);
    const page = pages[url.searchParams.get('cursor') ?? ''] ?? { items: [] };
    return Promise.resolve(Response.json(page));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, queries };
}

describe('auditoría (HU-10)', () => {
  it('sin sesión pide iniciar sesión y no llama al API', () => {
    const fetchMock = mockApi({});
    renderWithProviders(<AuditPage />);
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista los eventos con el token del auditor, sin datos personales', async () => {
    const { fetchMock } = auditApi({ '': { items: [PUBLISH, DENIED] } });
    renderWithProviders(<AuditPage />, { auth: signedInAuditor() });

    // «Publicación de proyecto» también es una opción del filtro: se espera al recurso.
    expect(await screen.findAllByText(PUBLISH.resourceRef)).toHaveLength(2);
    expect(screen.getByText('Denegado')).toBeInTheDocument();
    expect(screen.getAllByText('Publicación de proyecto')).toHaveLength(2);
    expect(screen.getByText(/2 eventos/)).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-auditor');
  });

  it('envía los filtros de tipo y fecha al buscar', async () => {
    const { queries } = auditApi({ '': { items: [PUBLISH] } });
    renderWithProviders(<AuditPage />, { auth: signedInAuditor() });
    await screen.findByText(PUBLISH.resourceRef);

    fireEvent.change(screen.getByLabelText('Tipo de evento'), {
      target: { value: 'PROJECT_PUBLISH' },
    });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await vi.waitFor(() => {
      expect(queries.at(-1)?.toString()).toBe(
        'eventType=PROJECT_PUBLISH&from=2026-11-10&to=2026-11-12&limit=50',
      );
    });
  });

  it('un rango invertido se marca como error y no se consulta', async () => {
    const { queries } = auditApi({ '': { items: [] } });
    renderWithProviders(<AuditPage />, { auth: signedInAuditor() });
    await screen.findByText('No hay eventos con esos filtros.');

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-14' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(screen.getByRole('alert')).toHaveTextContent('anterior o igual');
    expect(screen.getByLabelText('Desde')).toHaveAttribute('aria-invalid', 'true');
    expect(queries).toHaveLength(1);
  });

  it('«Cargar más» pide la página siguiente con el cursor', async () => {
    const { queries } = auditApi({
      '': { items: [PUBLISH], nextCursor: 'c1' },
      c1: { items: [DENIED] },
    });
    renderWithProviders(<AuditPage />, { auth: signedInAuditor() });

    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }));

    expect(await screen.findByText('Denegado')).toBeInTheDocument();
    expect(queries.at(-1)?.get('cursor')).toBe('c1');
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('un 403 del API se explica sin romper la página', async () => {
    mockApi({
      'GET /v1/audit': () => Response.json({ message: 'Forbidden' }, { status: 403 }),
    });
    renderWithProviders(<AuditPage />, { auth: signedInAuditor() });
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo las cuentas con rol AUDITOR');
  });

  it('el enlace «Auditoría» solo aparece para AUDITOR (el API decide igual)', () => {
    mockApi({ 'GET /v1/projects': () => Response.json({ items: [] }) });
    const { unmount } = renderWithProviders(<App />, {
      auth: fakeAuth({ status: 'authenticated', user: DONOR }),
    });
    expect(screen.queryByRole('link', { name: 'Auditoría' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<App />, { auth: signedInAuditor() });
    expect(screen.getByRole('link', { name: 'Auditoría' })).toBeInTheDocument();
  });
});
