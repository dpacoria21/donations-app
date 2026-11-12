/**
 * Revisión automática de accesibilidad con axe-core (CA-NF06.2): criterios WCAG 2.0, 2.1 y 2.2
 * de nivel A y AA más las buenas prácticas, sobre cada página del flujo principal. jsdom no
 * calcula estilos, así que el contraste y el reflujo a 375 px se revisan a mano en el navegador
 * (ver docs/accesibilidad.md).
 */
import { fireEvent, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { AuditEvent } from './audit/types.ts';
import type { AuthContextValue } from './auth/context.ts';
import { DRAFT, PUBLISHED } from './test/fixtures.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from './test/render.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PENDING = {
  donationId: '0d6f8a10-0000-4000-8000-000000000001',
  projectId: PUBLISHED.projectId,
  amountCents: 2_500,
  currency: 'PEN',
  status: 'PENDIENTE_SIMULACION',
  createdAt: '2026-11-13T10:00:00.000Z',
};
const EVENT: AuditEvent = {
  eventType: 'PROJECT_PUBLISH',
  eventId: '6f1c9a2e-0000-4000-8000-000000000001',
  timestamp: '2026-11-12T15:00:00.000Z',
  requestId: 'GuUxCg5XiYcEM1g=',
  actorRef: 'actor_3QmZ0k1x9aPq2LrT7vWbYc',
  actorRole: 'GESTOR',
  action: 'projects.publish',
  resourceRef: `project/${PUBLISHED.projectId}`,
  outcome: 'SUCCESS',
};

const as = (groups: string[]) =>
  fakeAuth({ status: 'authenticated', user: { ...DONOR, groups } }) satisfies AuthContextValue;

function api() {
  mockApi({
    'GET /v1/projects': () => Response.json({ items: [PUBLISHED] }),
    [`GET /v1/projects/${PUBLISHED.projectId}`]: () => Response.json(PUBLISHED),
    [`GET /v1/projects/${PUBLISHED.projectId}/stats`]: () =>
      Response.json({
        projectId: PUBLISHED.projectId,
        goalAmountCents: PUBLISHED.goalAmountCents,
        confirmedAmountCents: PUBLISHED.confirmedAmountCents,
        currency: 'PEN',
        progressPercent: 50,
      }),
    'GET /v1/donations/me': () => Response.json({ items: [PENDING] }),
    'GET /v1/manage/projects': () => Response.json({ items: [DRAFT, PUBLISHED] }),
    [`GET /v1/projects/${DRAFT.projectId}`]: () => Response.json(DRAFT),
    'GET /v1/audit': () => Response.json({ items: [EVENT] }),
  });
  // La consulta de auditoría lleva query string; mockApi la ignora al buscar la ruta.
}

/** Ejecuta axe sobre todo el documento y devuelve las violaciones legibles. */
async function violations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: {
      // jsdom no calcula colores ni tamaños: se revisan en el navegador.
      'color-contrast': { enabled: false },
      'target-size': { enabled: false },
    },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} → ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

describe('accesibilidad WCAG 2.2 AA con axe-core (CA-NF06.2)', () => {
  it('catálogo (HU-01), sin sesión', async () => {
    api();
    renderWithProviders(<App />, { route: '/' });
    await screen.findByRole('link', { name: PUBLISHED.title });
    expect(await violations()).toEqual([]);
  });

  it('detalle y formulario de donación (HU-02, HU-05), también con errores', async () => {
    api();
    renderWithProviders(<App />, {
      route: `/proyectos/${PUBLISHED.projectId}`,
      auth: as(['DONANTE']),
    });
    const submit = await screen.findByRole('button', { name: 'Registrar intención' });
    expect(await violations()).toEqual([]);

    // Con el error de validación visible y asociado al campo.
    fireEvent.click(submit);
    await screen.findByText(/Ingresa un monto|monto/i, { selector: 'p[id$="-error"]' });
    expect(await violations()).toEqual([]);
  });

  it('confirmación de la intención (HU-05)', async () => {
    api();
    mockApi({
      [`GET /v1/projects/${PUBLISHED.projectId}`]: () => Response.json(PUBLISHED),
      [`GET /v1/projects/${PUBLISHED.projectId}/stats`]: () => Response.json({}),
      'POST /v1/donations': () => Response.json(PENDING, { status: 201 }),
    });
    renderWithProviders(<App />, {
      route: `/proyectos/${PUBLISHED.projectId}`,
      auth: as(['DONANTE']),
    });
    fireEvent.change(await screen.findByLabelText('Monto en soles (S/)'), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar intención' }));
    await screen.findByText(/Intención registrada/);
    expect(await violations()).toEqual([]);
  });

  it('mi cuenta con historial y simulación (HU-06, HU-07)', async () => {
    api();
    renderWithProviders(<App />, { route: '/cuenta', auth: as(['DONANTE']) });
    await screen.findByRole('button', { name: /Simular confirmación/ });
    expect(await violations()).toEqual([]);
  });

  it('gestión y formulario de proyecto (HU-08)', async () => {
    api();
    const { unmount } = renderWithProviders(<App />, { route: '/gestion', auth: as(['GESTOR']) });
    await screen.findByRole('button', { name: `Publicar «${DRAFT.title}»` });
    expect(await violations()).toEqual([]);
    unmount();

    renderWithProviders(<App />, { route: '/gestion/nuevo', auth: as(['GESTOR']) });
    await screen.findByRole('button', { name: 'Crear borrador' });
    expect(await violations()).toEqual([]);
  });

  it('auditoría (HU-10)', async () => {
    api();
    renderWithProviders(<App />, { route: '/auditoria', auth: as(['AUDITOR']) });
    await screen.findByText('Éxito');
    expect(await violations()).toEqual([]);
  });

  it('página no encontrada', async () => {
    api();
    renderWithProviders(<App />, { route: '/no-existe' });
    await screen.findByRole('heading', { name: 'Página no encontrada' });
    expect(await violations()).toEqual([]);
  });

  it('cada página tiene su propio título (WCAG 2.4.2)', async () => {
    api();
    renderWithProviders(<App />, { route: `/proyectos/${PUBLISHED.projectId}` });
    await screen.findByRole('heading', { name: PUBLISHED.title });
    expect(document.title).toBe(`${PUBLISHED.title} · Fundación AQP-SOLIDARIA`);
  });
});
