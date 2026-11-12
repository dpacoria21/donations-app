import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPage } from '../pages/ProjectPage.tsx';
import { PUBLISHED } from '../test/fixtures.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from '../test/render.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const signedIn = fakeAuth({ status: 'authenticated', user: DONOR });
const DONATION = {
  donationId: '0d6f8a10-0000-4000-8000-000000000001',
  projectId: PUBLISHED.projectId,
  amountCents: 2_550,
  currency: 'PEN',
  status: 'PENDIENTE_SIMULACION',
  createdAt: '2026-11-13T10:00:00.000Z',
};

function api(donate: () => Response) {
  return mockApi({
    [`GET /v1/projects/${PUBLISHED.projectId}`]: () => Response.json(PUBLISHED),
    'POST /v1/donations': donate,
  });
}

function renderProject(auth = signedIn) {
  return renderWithProviders(
    <Routes>
      <Route path="/proyectos/:projectId" element={<ProjectPage />} />
    </Routes>,
    { route: `/proyectos/${PUBLISHED.projectId}`, auth },
  );
}

async function submitAmount(value: string) {
  const input = await screen.findByLabelText('Monto en soles (S/)');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar intención' }));
}

const donationPosts = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('formulario de donación (HU-05)', () => {
  it('un visitante ve «Iniciar sesión para donar» y vuelve al proyecto tras el login', async () => {
    api(() => Response.json(DONATION, { status: 201 }));
    const { auth } = renderProject(fakeAuth());
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar sesión para donar' }));
    expect(auth.login).toHaveBeenCalledWith(`/proyectos/${PUBLISHED.projectId}`);
  });

  it('no pide datos de pago, solo el monto (CA-05.5)', async () => {
    api(() => Response.json(DONATION, { status: 201 }));
    renderProject();
    await screen.findByLabelText('Monto en soles (S/)');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText(/No pedimos datos de tarjeta/)).toBeInTheDocument();
  });

  it('valida el rango S/ 1.00 – S/ 1,000.00 sin llamar al API', async () => {
    const fetchMock = api(() => Response.json(DONATION, { status: 201 }));
    renderProject();
    for (const value of ['0.50', '1000.01', '12.345']) {
      await submitAmount(value);
      expect(
        await screen.findByText(/entre S\/ 1.00 y S\/ 1,000.00|hasta 2 decimales/),
      ).toBeInTheDocument();
    }
    expect(donationPosts(fetchMock)).toHaveLength(0);
  });

  it('envía céntimos y una Idempotency-Key UUID, y muestra el aviso de simulación (CA-06.4)', async () => {
    const fetchMock = api(() => Response.json(DONATION, { status: 201 }));
    renderProject();

    await submitAmount('25,50');

    expect(await screen.findByText(/no se ha realizado ningún cobro/)).toBeInTheDocument();
    const init = donationPosts(fetchMock)[0]?.[1];
    expect(JSON.parse(init?.body as string)).toEqual({
      projectId: PUBLISHED.projectId,
      amountCents: 2_550,
    });
    expect(new Headers(init?.headers).get('idempotency-key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('tras un fallo de red, reintentar el mismo monto reutiliza la misma clave (CA-05.4)', async () => {
    let attempt = 0;
    const fetchMock = api(() => {
      attempt += 1;
      return attempt === 1
        ? Response.json({ message: 'Error' }, { status: 503 })
        : Response.json(DONATION, { status: 201 });
    });
    renderProject();

    await submitAmount('25.50');
    expect(await screen.findByRole('alert')).toHaveTextContent('no se duplicará');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar intención' }));
    await screen.findByText(/no se ha realizado ningún cobro/);

    const keys = donationPosts(fetchMock).map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key'),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('una nueva intención (otro monto o tras un éxito) usa una clave nueva', async () => {
    const fetchMock = api(() => Response.json(DONATION, { status: 201 }));
    renderProject();

    await submitAmount('25.50');
    await screen.findByText(/no se ha realizado ningún cobro/);
    await submitAmount('25.50');
    await waitFor(() => {
      expect(donationPosts(fetchMock)).toHaveLength(2);
    });

    const [first, second] = donationPosts(fetchMock).map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key'),
    );
    expect(first).not.toBe(second);
  });

  it('un GESTOR ve el 403 del API (la interfaz no decide el rol)', async () => {
    api(() => Response.json({ code: 'FORBIDDEN' }, { status: 403 }));
    renderProject(fakeAuth({ status: 'authenticated', user: { ...DONOR, groups: ['GESTOR'] } }));
    await submitAmount('10');
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo las cuentas con rol DONANTE');
  });
});
