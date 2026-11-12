import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { DONOR, fakeAuth, mockFetch, renderWithProviders } from './test/render.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('muestra el aviso de prototipo académico (CA-NF10.2)', () => {
    mockFetch(Response.json({ items: [] }));
    renderWithProviders(<App />);
    expect(screen.getByRole('note')).toHaveTextContent('no se realiza ningún cobro');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Donaciones seguras');
  });

  it('indica cuántos proyectos devuelve el API', async () => {
    const fetchMock = mockFetch(Response.json({ items: [{}, {}, {}] }));
    renderWithProviders(<App />);
    expect(await screen.findByText(/Conectado: 3 proyectos/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/projects$/),
      expect.anything(),
    );
  });

  it('informa si el backend no responde', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    renderWithProviders(<App />);
    expect(await screen.findByText(/No se pudo conectar/)).toBeInTheDocument();
  });

  it('muestra 404 para rutas desconocidas', () => {
    renderWithProviders(<App />, { route: '/no-existe' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Página no encontrada');
  });
});

describe('botón de sesión', () => {
  it('sin Cognito configurado no se muestra', () => {
    mockFetch(Response.json({ items: [] }));
    renderWithProviders(<App />, { auth: fakeAuth({ configured: false }) });
    expect(screen.queryByRole('button', { name: /sesión/ })).not.toBeInTheDocument();
  });

  it('un visitante puede iniciar sesión', () => {
    mockFetch(Response.json({ items: [] }));
    const { auth } = renderWithProviders(<App />);
    screen.getByRole('button', { name: 'Iniciar sesión' }).click();
    expect(auth.login).toHaveBeenCalled();
  });

  it('un usuario autenticado puede cerrar sesión (CA-03.3)', () => {
    mockFetch(Response.json({ items: [] }));
    const { auth } = renderWithProviders(<App />, {
      auth: fakeAuth({ status: 'authenticated', user: DONOR }),
    });
    screen.getByRole('button', { name: 'Cerrar sesión' }).click();
    expect(auth.logout).toHaveBeenCalled();
  });
});
