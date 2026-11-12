import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { PUBLISHED } from '../test/fixtures.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from '../test/render.tsx';
import { AccountPage } from './AccountPage.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const signedIn = fakeAuth({ status: 'authenticated', user: DONOR });
const PENDING = {
  donationId: '0d6f8a10-0000-4000-8000-000000000001',
  projectId: PUBLISHED.projectId,
  amountCents: 2_500,
  currency: 'PEN',
  status: 'PENDIENTE_SIMULACION',
  createdAt: '2026-11-13T10:00:00.000Z',
};
const CONFIRMED = {
  ...PENDING,
  donationId: '0d6f8a10-0000-4000-8000-000000000002',
  status: 'CONFIRMADA_SIMULADA',
};
const SIMULATE = `POST /v1/donations/${PENDING.donationId}/simulate`;

function api(simulate: () => Response) {
  return mockApi({
    'GET /v1/donations/me': () => Response.json({ items: [PENDING, CONFIRMED] }),
    'GET /v1/projects': () => Response.json({ items: [PUBLISHED] }),
    [SIMULATE]: simulate,
  });
}

describe('simulación en Mi cuenta (HU-06)', () => {
  it('muestra el texto exacto del aviso de simulación (CA-06.4)', async () => {
    api(() => Response.json({}));
    renderWithProviders(<AccountPage />, { auth: signedIn });
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Simulación académica: no se ha realizado ningún cobro.',
    );
  });

  it('solo ofrece simular las donaciones pendientes', async () => {
    api(() => Response.json({}));
    renderWithProviders(<AccountPage />, { auth: signedIn });
    expect(await screen.findAllByRole('button', { name: /Simular confirmación/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Simular rechazo/ })).toHaveLength(1);
  });

  it('confirmar llama al endpoint con el resultado y muestra el resultado', async () => {
    const fetchMock = api(() => Response.json({ ...PENDING, status: 'CONFIRMADA_SIMULADA' }));
    renderWithProviders(<AccountPage />, { auth: signedIn });

    fireEvent.click(await screen.findByRole('button', { name: /Simular confirmación/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /confirmada \(simulada\).*no se ha realizado ningún cobro/,
    );
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ outcome: 'CONFIRMADA_SIMULADA' });
    expect(new Headers(call?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${DONOR.accessToken}`,
    );
  });

  it('rechazar envía RECHAZADA_SIMULADA', async () => {
    const fetchMock = api(() => Response.json({ ...PENDING, status: 'RECHAZADA_SIMULADA' }));
    renderWithProviders(<AccountPage />, { auth: signedIn });
    fireEvent.click(await screen.findByRole('button', { name: /Simular rechazo/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({ outcome: 'RECHAZADA_SIMULADA' });
    });
  });

  it('un 409 (ya simulada) se muestra sin romper la página', async () => {
    api(() =>
      Response.json({ code: 'CONFLICT', message: 'La donación ya fue simulada' }, { status: 409 }),
    );
    renderWithProviders(<AccountPage />, { auth: signedIn });
    fireEvent.click(await screen.findByRole('button', { name: /Simular confirmación/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La donación ya fue simulada');
  });
});

describe('aviso legal del prototipo (CA-NF10.2)', () => {
  it('el pie de página menciona la Ley N.º 29733', () => {
    mockApi({ 'GET /v1/projects': () => Response.json({ items: [] }) });
    renderWithProviders(<App />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Ley N.º 29733');
  });
});
