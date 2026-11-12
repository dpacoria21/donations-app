import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { ApiError, getJson, sendJson } from '../api/client.ts';
import { useAuth, type SessionUser } from '../auth/context.ts';
import { SignInPrompt } from '../components/SignInPrompt.tsx';
import { formatDateTime, formatPen } from '../lib/format.ts';
import { projectKeys, type Project, type ProjectList } from '../projects/types.ts';
import { PageTitle } from '../components/PageTitle.tsx';

/** Mensaje que deja el formulario al volver aquí, por ejemplo «Proyecto creado». */
export interface ManageLocationState {
  notice?: string;
}

/**
 * Panel del GESTOR (HU-08): todos los proyectos, también los BORRADOR, con acciones para
 * editar y publicar. Ocultar el enlace no protege nada: el API exige el grupo GESTOR.
 */
export function ManagePage() {
  const { user } = useAuth();
  const notice = (useLocation().state as ManageLocationState | null)?.notice;

  if (!user) {
    return (
      <SignInPrompt
        title="Gestión de proyectos"
        message="Inicia sesión con una cuenta de gestor para crear, editar y publicar proyectos."
      />
    );
  }
  return <ManagedProjects user={user} notice={notice} />;
}

function ManagedProjects({ user, notice }: { user: SessionUser; notice?: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: projectKeys.managed,
    queryFn: ({ signal }) =>
      getJson<ProjectList>('/v1/manage/projects', { accessToken: user.accessToken, signal }),
  });
  const publish = useMutation({
    mutationFn: (projectId: string) =>
      sendJson<Project>('PATCH', `/v1/projects/${projectId}/publish`, {
        accessToken: user.accessToken,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>Gestión de proyectos</PageTitle>
        <h1 className="text-2xl font-bold">Gestión de proyectos</h1>
        <Link
          to="/gestion/nuevo"
          className="rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          Nuevo proyecto
        </Link>
      </div>

      {/* El aviso del formulario se reemplaza por el resultado de la siguiente acción. */}
      {notice && publish.isIdle && (
        <p role="status" className="mt-4 rounded bg-emerald-50 px-3 py-2 text-emerald-900">
          {notice}
        </p>
      )}
      {publish.isError && (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-red-800">
          No se pudo publicar: {publish.error.message}
        </p>
      )}
      {publish.isSuccess && (
        <p role="status" className="mt-4 rounded bg-emerald-50 px-3 py-2 text-emerald-900">
          «{publish.data.title}» ya está publicado en el catálogo.
        </p>
      )}

      {query.isPending && (
        <p role="status" className="mt-6">
          Cargando proyectos…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="mt-6 text-red-800">
          {query.error instanceof ApiError && query.error.status === 403
            ? 'Solo los usuarios con rol GESTOR pueden gestionar proyectos.'
            : 'No se pudieron cargar los proyectos. Inténtalo de nuevo más tarde.'}
        </p>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <p className="mt-6 text-slate-700">Aún no hay proyectos. Crea el primero.</p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {query.data.items.map((project) => (
            <li key={project.projectId} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{project.title}</p>
                <p className="text-sm text-slate-600">
                  <StatusBadge status={project.status} /> · Meta{' '}
                  {formatPen(project.goalAmountCents)} · Recaudado{' '}
                  {formatPen(project.confirmedAmountCents)}
                </p>
                <p className="text-xs text-slate-500">
                  Actualizado: {formatDateTime(project.updatedAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/gestion/${project.projectId}/editar`}
                  aria-label={`Editar «${project.title}»`}
                  className="rounded border border-sky-700 px-3 py-1 text-sm font-semibold text-sky-800 hover:bg-sky-50"
                >
                  Editar
                </Link>
                {project.status === 'BORRADOR' && (
                  <button
                    type="button"
                    disabled={publish.isPending}
                    onClick={() => {
                      publish.mutate(project.projectId);
                    }}
                    aria-label={`Publicar «${project.title}»`}
                    className="rounded bg-emerald-700 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    Publicar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Project['status'] }) {
  return status === 'PUBLICADO' ? (
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-900">
      Publicado
    </span>
  ) : (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
      Borrador
    </span>
  );
}
