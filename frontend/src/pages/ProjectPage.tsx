import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError, getJson } from '../api/client.ts';
import { ProjectProgress } from '../components/ProjectProgress.tsx';
import { formatDateTime } from '../lib/format.ts';
import { projectKeys, type Project, type ProjectStats } from '../projects/types.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

/**
 * Detalle público de un proyecto (HU-02) con sus indicadores agregados (HU-09). Un proyecto
 * inexistente o en BORRADOR responde 404 en el API, y aquí se muestra la página 404.
 */
export function ProjectPage() {
  const { projectId = '' } = useParams();
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: ({ signal }) => getJson<Project>(`/v1/projects/${projectId}`, { signal }),
  });
  const stats = useQuery({
    queryKey: projectKeys.stats(projectId),
    queryFn: ({ signal }) => getJson<ProjectStats>(`/v1/projects/${projectId}/stats`, { signal }),
    enabled: project.isSuccess,
  });

  if (project.isPending) {
    return (
      <p role="status" className="mt-2">
        Cargando el proyecto…
      </p>
    );
  }
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) {
      return <NotFoundPage title="Proyecto no encontrado" />;
    }
    return (
      <p role="alert" className="mt-2 text-red-800">
        No se pudo cargar el proyecto. Inténtalo de nuevo más tarde.
      </p>
    );
  }

  const data = project.data;
  return (
    <article>
      <Link to="/" className="text-sm text-sky-800 underline">
        ← Volver al catálogo
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{data.title}</h1>
      <p className="mt-3 whitespace-pre-line text-slate-800">{data.description}</p>

      <section
        aria-labelledby="avance"
        className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="avance" className="font-semibold">
          Avance de la campaña
        </h2>
        <ProjectProgress
          confirmedAmountCents={stats.data?.confirmedAmountCents ?? data.confirmedAmountCents}
          goalAmountCents={stats.data?.goalAmountCents ?? data.goalAmountCents}
          percent={stats.data?.progressPercent}
        />
        <p className="mt-2 text-xs text-slate-600">
          Solo se suman las donaciones simuladas confirmadas (CA-09.1).
        </p>
      </section>

      <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-semibold">Estado</dt>
        <dd>{data.status === 'PUBLICADO' ? 'Publicado' : 'Borrador'}</dd>
        <dt className="font-semibold">Última actualización</dt>
        <dd>
          {/* `updatedAt` llega desde la fase 3; un API anterior no lo envía. */}
          {data.updatedAt ? (
            <time dateTime={data.updatedAt}>{formatDateTime(data.updatedAt)}</time>
          ) : (
            '—'
          )}
        </dd>
        <dt className="font-semibold">Identificador</dt>
        <dd className="break-all font-mono text-xs">{data.projectId}</dd>
      </dl>
    </article>
  );
}
