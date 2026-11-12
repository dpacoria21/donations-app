import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DONOR, fakeAuth, mockFetch, renderWithProviders } from '../test/render.tsx';
import { AccountPage } from './AccountPage.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const signedIn = fakeAuth({ status: 'authenticated', user: DONOR });

describe('Mi cuenta (HU-07)', () => {
  it('sin Cognito configurado explica qué falta', () => {
    renderWithProviders(<AccountPage />, { auth: fakeAuth({ configured: false }) });
    expect(screen.getByText(/VITE_COGNITO_/)).toBeInTheDocument();
  });

  it('un visitante ve el botón de inicio de sesión y no se llama al API', () => {
    const fetchMock = mockFetch(Response.json({ items: [] }));
    const { auth } = renderWithProviders(<AccountPage />);

    screen.getByRole('button', { name: 'Iniciar sesión' }).click();

    expect(auth.login).toHaveBeenCalledWith('/cuenta');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pide el historial con el access token en Authorization y lo muestra', async () => {
    const fetchMock = mockFetch(
      Response.json({
        items: [
          {
            donationId: '0d6f8a10-0000-4000-8000-000000000003',
            projectId: '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63',
            amountCents: 7_550,
            currency: 'PEN',
            status: 'PENDIENTE_SIMULACION',
            createdAt: '2026-11-11T09:00:00.000Z',
          },
        ],
      }),
    );
    renderWithProviders(<AccountPage />, { auth: signedIn });

    expect(await screen.findByText('Pendiente de simulación')).toBeInTheDocument();
    expect(screen.getByText(/75[.,]50/)).toBeInTheDocument();
    expect(screen.getByText('donante1@example.com')).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(expect.stringMatching(/\/v1\/donations\/me$/));
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${DONOR.accessToken}`);
  });

  it('sin donaciones lo indica', async () => {
    mockFetch(Response.json({ items: [] }));
    renderWithProviders(<AccountPage />, { auth: signedIn });
    expect(await screen.findByText('Aún no tienes donaciones.')).toBeInTheDocument();
  });

  it('si el API responde 403 muestra el motivo sin datos (CA-04.2)', async () => {
    mockFetch(Response.json({ message: 'Forbidden' }, { status: 403 }));
    renderWithProviders(<AccountPage />, {
      auth: fakeAuth({ status: 'authenticated', user: { ...DONOR, groups: ['GESTOR'] } }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('no tiene el rol DONANTE');
  });

  it('si el token expiró (401) pide volver a iniciar sesión', async () => {
    mockFetch(Response.json({ message: 'Unauthorized' }, { status: 401 }));
    renderWithProviders(<AccountPage />, { auth: signedIn });
    expect(await screen.findByRole('alert')).toHaveTextContent('sesión expiró');
  });
});
