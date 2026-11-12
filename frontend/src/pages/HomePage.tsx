import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getJson } from '../api/client.ts';
import { ProjectProgress } from '../components/ProjectProgress.tsx';
import { projectKeys, type ProjectList } from '../projects/types.ts';
import { PageTitle } from '../components/PageTitle.tsx';

/** Catálogo público: solo proyectos PUBLICADO, del más reciente al más antiguo (HU-01). */
export function HomePage() {
  const query = useQuery({
    queryKey: projectKeys.published,
    queryFn: ({ signal }) => getJson<ProjectList>('/v1/projects', { signal }),
  });

  return (
    <>
      <PageTitle>Proyectos sociales</PageTitle>
      <h1 className="text-2xl font-bold">Proyectos sociales</h1>
      <p className="mt-2 text-slate-600">
        Campañas de la Fundación AQP-SOLIDARIA. Los montos son simulados.
      </p>

      {query.isPending && (
        <p role="status" className="mt-6">
          Cargando proyectos…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="mt-6 text-red-800">
          No se pudieron cargar los proyectos. Inténtalo de nuevo más tarde.
        </p>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <p className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-slate-700">
          Todavía no hay proyectos publicados. Vuelve pronto.
        </p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {query.data.items.map((project) => (
            <li
              key={project.projectId}
              className="flex flex-col rounded-lg border border-slate-200 bg-white p-4"
            >
              <h2 className="text-lg font-semibold">
                <Link
                  to={`/proyectos/${project.projectId}`}
                  className="text-sky-800 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-sky-700"
                >
                  {project.title}
                </Link>
              </h2>
              <p className="mt-1 line-clamp-3 text-sm text-slate-700">{project.description}</p>
              <div className="mt-auto">
                <ProjectProgress
                  confirmedAmountCents={project.confirmedAmountCents}
                  goalAmountCents={project.goalAmountCents}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
