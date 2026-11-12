import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLISHED } from '../test/fixtures.ts';
import { mockApi, renderWithProviders } from '../test/render.tsx';
import { HomePage } from './HomePage.tsx';
import { ProjectPage } from './ProjectPage.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catálogo (HU-01)', () => {
  it('muestra nombre, finalidad, meta y monto confirmado en PEN', async () => {
    mockApi({ 'GET /v1/projects': () => Response.json({ items: [PUBLISHED] }) });
    renderWithProviders(<HomePage />);

    const card = (await screen.findByRole('link', { name: PUBLISHED.title })).closest('li');
    expect(card).not.toBeNull();
    const scope = within(card as HTMLElement);
    expect(scope.getByText(PUBLISHED.description)).toBeInTheDocument();
    expect(scope.getByText(/6[,.]?125[.,]50/)).toBeInTheDocument();
    expect(scope.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '76');
  });

  it('sin proyectos publicados muestra un estado vacío comprensible (CA-01.3)', async () => {
    mockApi({ 'GET /v1/projects': () => Response.json({ items: [] }) });
    renderWithProviders(<HomePage />);
    expect(await screen.findByText(/Todavía no hay proyectos publicados/)).toBeInTheDocument();
  });

  it('si el API falla, lo informa', async () => {
    mockApi({ 'GET /v1/projects': () => Response.json({ message: 'x' }, { status: 500 }) });
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar');
  });
});

function renderDetail(projectId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/proyectos/:projectId" element={<ProjectPage />} />
    </Routes>,
    { route: `/proyectos/${projectId}` },
  );
}

describe('detalle (HU-02, HU-09)', () => {
  it('muestra descripción, estado, avance confirmado y última actualización', async () => {
    mockApi({
      [`GET /v1/projects/${PUBLISHED.projectId}`]: () => Response.json(PUBLISHED),
      [`GET /v1/projects/${PUBLISHED.projectId}/stats`]: () =>
        Response.json({
          projectId: PUBLISHED.projectId,
          goalAmountCents: 800_000,
          confirmedAmountCents: 612_550,
          currency: 'PEN',
          progressPercent: 76,
        }),
    });
    renderDetail(PUBLISHED.projectId);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(PUBLISHED.title);
    expect(screen.getByText('Publicado')).toBeInTheDocument();
    expect(screen.getByText('Última actualización')).toBeInTheDocument();
    expect(screen.getByText(PUBLISHED.projectId)).toBeInTheDocument();
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '76');
  });

  it('no se rompe si el API no envía updatedAt (versión desplegada anterior)', async () => {
    const withoutUpdatedAt: Partial<typeof PUBLISHED> = { ...PUBLISHED };
    delete withoutUpdatedAt.updatedAt;
    mockApi({
      [`GET /v1/projects/${PUBLISHED.projectId}`]: () => Response.json(withoutUpdatedAt),
    });
    renderDetail(PUBLISHED.projectId);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(PUBLISHED.title);
    expect(screen.getByText('Última actualización').nextElementSibling).toHaveTextContent('—');
  });

  it('un proyecto inexistente o en borrador muestra la página 404 (CA-02.2)', async () => {
    mockApi({});
    renderDetail('00000000-0000-4000-8000-000000000000');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Proyecto no encontrado',
    );
  });
});
