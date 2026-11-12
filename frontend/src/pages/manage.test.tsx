import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAFT, PUBLISHED } from '../test/fixtures.ts';
import { DONOR, fakeAuth, mockApi, renderWithProviders } from '../test/render.tsx';
import { ManagePage } from './ManagePage.tsx';
import { ProjectFormPage } from './ProjectFormPage.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const MANAGER = { ...DONOR, groups: ['GESTOR'], accessToken: 'token-gestor' };
const signedInManager = () => fakeAuth({ status: 'authenticated', user: MANAGER });
const managedList = () => Response.json({ items: [DRAFT, PUBLISHED] });

function renderManage(route: string, auth = signedInManager()) {
  return renderWithProviders(
    <Routes>
      <Route path="/gestion" element={<ManagePage />} />
      <Route path="/gestion/nuevo" element={<ProjectFormPage mode="create" />} />
      <Route path="/gestion/:projectId/editar" element={<ProjectFormPage mode="edit" />} />
    </Routes>,
    { route, auth },
  );
}

function bodyOf(fetchMock: ReturnType<typeof mockApi>, method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
}

describe('panel de gestión (HU-08)', () => {
  it('sin sesión pide iniciar sesión y no llama al API', () => {
    const fetchMock = mockApi({});
    renderManage('/gestion', fakeAuth());
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista también los borradores y solo ofrece publicar los BORRADOR', async () => {
    const fetchMock = mockApi({ 'GET /v1/manage/projects': managedList });
    renderManage('/gestion');

    expect(await screen.findByText(DRAFT.title)).toBeInTheDocument();
    expect(screen.getByText(PUBLISHED.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Publicar «${DRAFT.title}»` })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Publicar «${PUBLISHED.title}»` }),
    ).not.toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-gestor');
  });

  it('publicar llama a PATCH /publish y confirma el resultado', async () => {
    const fetchMock = mockApi({
      'GET /v1/manage/projects': managedList,
      [`PATCH /v1/projects/${DRAFT.projectId}/publish`]: () =>
        Response.json({ ...DRAFT, status: 'PUBLICADO' }),
    });
    renderManage('/gestion');

    fireEvent.click(await screen.findByRole('button', { name: `Publicar «${DRAFT.title}»` }));

    expect(await screen.findByText(/ya está publicado en el catálogo/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
  });

  it('muestra el 409 del API si el proyecto ya estaba publicado (CA-08.2)', async () => {
    mockApi({
      'GET /v1/manage/projects': managedList,
      [`PATCH /v1/projects/${DRAFT.projectId}/publish`]: () =>
        Response.json(
          { code: 'CONFLICT', message: 'El proyecto ya está publicado' },
          { status: 409 },
        ),
    });
    renderManage('/gestion');

    fireEvent.click(await screen.findByRole('button', { name: `Publicar «${DRAFT.title}»` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El proyecto ya está publicado');
  });

  it('un DONANTE ve el 403 del API, no la lista (CA-04.1)', async () => {
    mockApi({
      'GET /v1/manage/projects': () => Response.json({ code: 'FORBIDDEN' }, { status: 403 }),
    });
    renderManage('/gestion', fakeAuth({ status: 'authenticated', user: DONOR }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo los usuarios con rol GESTOR');
  });
});

describe('crear proyecto (CA-08.1)', () => {
  it('valida en el navegador sin llamar al API: campos vacíos y meta no válida', async () => {
    const fetchMock = mockApi({});
    renderManage('/gestion/nuevo');

    fireEvent.change(screen.getByLabelText('Meta en soles (S/)'), { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    expect(await screen.findByText(/al menos 3 caracteres/)).toBeInTheDocument();
    expect(screen.getByText(/al menos 10 caracteres/)).toBeInTheDocument();
    expect(screen.getByText(/hasta 2 decimales/)).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía la meta en céntimos enteros y vuelve al panel con un aviso', async () => {
    const fetchMock = mockApi({
      'POST /v1/projects': () =>
        Response.json({ ...DRAFT, title: 'Huertos escolares' }, { status: 201 }),
      'GET /v1/manage/projects': managedList,
    });
    renderManage('/gestion/nuevo');

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Huertos escolares' } });
    fireEvent.change(screen.getByLabelText('Descripción (finalidad del proyecto)'), {
      target: { value: 'Semillas y herramientas para huertos escolares.' },
    });
    fireEvent.change(screen.getByLabelText('Meta en soles (S/)'), { target: { value: '3000,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    expect(await screen.findByText('Se creó el borrador «Huertos escolares».')).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'POST')).toEqual({
      title: 'Huertos escolares',
      description: 'Semillas y herramientas para huertos escolares.',
      goalAmountCents: 300_050,
    });
  });

  it('si el API responde 403, lo muestra (la interfaz no decide permisos)', async () => {
    mockApi({
      'POST /v1/projects': () => Response.json({ code: 'FORBIDDEN' }, { status: 403 }),
    });
    renderManage('/gestion/nuevo');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Huertos escolares' } });
    fireEvent.change(screen.getByLabelText('Descripción (finalidad del proyecto)'), {
      target: { value: 'Semillas y herramientas para huertos escolares.' },
    });
    fireEvent.change(screen.getByLabelText('Meta en soles (S/)'), { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Solo los usuarios con rol GESTOR');
  });
});

describe('editar proyecto (decisión D2)', () => {
  it('rellena el formulario y envía solo los campos que cambiaron', async () => {
    const fetchMock = mockApi({
      'GET /v1/manage/projects': managedList,
      [`PATCH /v1/projects/${PUBLISHED.projectId}`]: () =>
        Response.json({ ...PUBLISHED, goalAmountCents: 900_000 }),
    });
    renderManage(`/gestion/${PUBLISHED.projectId}/editar`);

    const goal = await screen.findByLabelText('Meta en soles (S/)');
    expect(goal).toHaveValue('8000.00');
    expect(screen.getByLabelText('Título')).toHaveValue(PUBLISHED.title);
    expect(screen.getByText(/Ya se recaudaron .*: la meta no puede ser menor/)).toBeInTheDocument();

    fireEvent.change(goal, { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, 'PATCH')).toEqual({ goalAmountCents: 900_000 });
    });
  });

  it('sin cambios no llama al API', async () => {
    const fetchMock = mockApi({ 'GET /v1/manage/projects': managedList });
    renderManage(`/gestion/${PUBLISHED.projectId}/editar`);
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No hay cambios que guardar');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('el 409 de una meta menor que lo recaudado se muestra junto al campo', async () => {
    mockApi({
      'GET /v1/manage/projects': managedList,
      [`PATCH /v1/projects/${PUBLISHED.projectId}`]: () =>
        Response.json(
          { code: 'CONFLICT', message: 'La meta no puede ser menor que el monto ya recaudado' },
          { status: 409 },
        ),
    });
    renderManage(`/gestion/${PUBLISHED.projectId}/editar`);

    fireEvent.change(await screen.findByLabelText('Meta en soles (S/)'), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('La meta no puede ser menor que el monto ya recaudado'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Meta en soles (S/)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un proyecto que no existe muestra 404', async () => {
    mockApi({ 'GET /v1/manage/projects': managedList });
    renderManage('/gestion/00000000-0000-4000-8000-000000000000/editar');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Proyecto no encontrado',
    );
  });
});
