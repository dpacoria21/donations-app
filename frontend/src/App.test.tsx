import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { PUBLISHED } from './test/fixtures.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from './test/render.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const emptyCatalog = { 'GET /v1/projects': () => Response.json({ items: [] }) };

describe('App', () => {
  it('muestra el aviso de prototipo académico (CA-NF10.2)', () => {
    mockApi(emptyCatalog);
    renderWithProviders(<App />);
    expect(screen.getByRole('note')).toHaveTextContent('no se realiza ningún cobro');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Proyectos sociales');
  });

  it('muestra 404 para rutas desconocidas', () => {
    renderWithProviders(<App />, { route: '/no-existe' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Página no encontrada');
  });

  it('el enlace «Gestión» solo aparece para un GESTOR (solo orienta; el API decide)', () => {
    mockApi(emptyCatalog);
    const { unmount } = renderWithProviders(<App />, {
      auth: fakeAuth({ status: 'authenticated', user: DONOR }),
    });
    expect(screen.queryByRole('link', { name: 'Gestión' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<App />, {
      auth: fakeAuth({ status: 'authenticated', user: { ...DONOR, groups: ['GESTOR'] } }),
    });
    expect(screen.getByRole('link', { name: 'Gestión' })).toHaveAttribute('href', '/gestion');
  });

  it('el detalle de un proyecto se abre desde el catálogo', async () => {
    mockApi({ 'GET /v1/projects': () => Response.json({ items: [PUBLISHED] }) });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: PUBLISHED.title })).toHaveAttribute(
      'href',
      `/proyectos/${PUBLISHED.projectId}`,
    );
  });
});

describe('botón de sesión', () => {
  it('sin Cognito configurado no se muestra', () => {
    mockApi(emptyCatalog);
    renderWithProviders(<App />, { auth: fakeAuth({ configured: false }) });
    expect(screen.queryByRole('button', { name: /sesión/ })).not.toBeInTheDocument();
  });

  it('un visitante puede iniciar sesión', () => {
    mockApi(emptyCatalog);
    const { auth } = renderWithProviders(<App />);
    screen.getByRole('button', { name: 'Iniciar sesión' }).click();
    expect(auth.login).toHaveBeenCalled();
  });

  it('un usuario autenticado puede cerrar sesión (CA-03.3)', () => {
    mockApi(emptyCatalog);
    const { auth } = renderWithProviders(<App />, {
      auth: fakeAuth({ status: 'authenticated', user: DONOR }),
    });
    screen.getByRole('button', { name: 'Cerrar sesión' }).click();
    expect(auth.logout).toHaveBeenCalled();
  });
});
