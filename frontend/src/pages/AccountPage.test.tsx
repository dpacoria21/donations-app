import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLISHED } from '../test/fixtures.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from '../test/render.tsx';
import { AccountPage } from './AccountPage.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const signedIn = fakeAuth({ status: 'authenticated', user: DONOR });
const catalog = () => Response.json({ items: [PUBLISHED] });
const DONATION = {
  donationId: '0d6f8a10-0000-4000-8000-000000000003',
  projectId: PUBLISHED.projectId,
  amountCents: 7_550,
  currency: 'PEN',
  status: 'PENDIENTE_SIMULACION',
  createdAt: '2026-11-11T09:00:00.000Z',
};

describe('Mi cuenta (HU-07)', () => {
  it('sin Cognito configurado explica qué falta', () => {
    renderWithProviders(<AccountPage />, { auth: fakeAuth({ configured: false }) });
    expect(screen.getByText(/VITE_COGNITO_/)).toBeInTheDocument();
  });

  it('un visitante ve el botón de inicio de sesión y no se llama al API', () => {
    const fetchMock = mockApi({});
    const { auth } = renderWithProviders(<AccountPage />);

    screen.getByRole('button', { name: 'Iniciar sesión' }).click();

    expect(auth.login).toHaveBeenCalledWith('/cuenta');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muestra proyecto, fecha, importe y estado, con el token en Authorization (CA-07.1)', async () => {
    const fetchMock = mockApi({
      'GET /v1/donations/me': () => Response.json({ items: [DONATION] }),
      'GET /v1/projects': catalog,
    });
    renderWithProviders(<AccountPage />, { auth: signedIn });

    expect(await screen.findByText('Pendiente de simulación')).toBeInTheDocument();
    expect(screen.getByText(/75[.,]50/)).toBeInTheDocument();
    expect(screen.getByText('donante1@example.com')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: PUBLISHED.title })).toHaveAttribute(
      'href',
      `/proyectos/${PUBLISHED.projectId}`,
    );

    const call = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/v1/donations/me'),
    );
    expect(new Headers(call?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${DONOR.accessToken}`,
    );
  });

  it('sin donaciones lo indica', async () => {
    mockApi({
      'GET /v1/donations/me': () => Response.json({ items: [] }),
      'GET /v1/projects': catalog,
    });
    renderWithProviders(<AccountPage />, { auth: signedIn });
    expect(await screen.findByText(/Aún no tienes donaciones/)).toBeInTheDocument();
  });

  it('si el API responde 403 muestra el motivo sin datos (CA-04.2)', async () => {
    mockApi({
      'GET /v1/donations/me': () => Response.json({ message: 'Forbidden' }, { status: 403 }),
      'GET /v1/projects': catalog,
    });
    renderWithProviders(<AccountPage />, {
      auth: fakeAuth({ status: 'authenticated', user: { ...DONOR, groups: ['GESTOR'] } }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('no tiene el rol DONANTE');
  });

  it('si el token expiró (401) pide volver a iniciar sesión', async () => {
    mockApi({
      'GET /v1/donations/me': () => Response.json({ message: 'Unauthorized' }, { status: 401 }),
      'GET /v1/projects': catalog,
    });
    renderWithProviders(<AccountPage />, { auth: signedIn });
    expect(await screen.findByRole('alert')).toHaveTextContent('sesión expiró');
  });
});
