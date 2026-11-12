import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError, getJson, sendJson } from '../api/client.ts';
import { useAuth, type SessionUser } from '../auth/context.ts';
import {
  donationKeys,
  STATUS_LABELS,
  type DonorDonation,
  type SimulationOutcome,
} from '../donations/types.ts';
import { formatDateTime, formatPen } from '../lib/format.ts';
import { projectKeys, type ProjectList } from '../projects/types.ts';
import { PageTitle } from '../components/PageTitle.tsx';

/** Mi cuenta: datos de la sesión e historial propio (HU-07, GET /v1/donations/me). */
export function AccountPage() {
  const { configured, status, user, login } = useAuth();

  if (!configured) {
    return (
      <Section title="Mi cuenta">
        <p className="mt-2 text-slate-700">
          El inicio de sesión no está configurado. Completa las variables{' '}
          <code>VITE_COGNITO_*</code> de <code>.env</code> con las salidas de la pila.
        </p>
      </Section>
    );
  }

  if (status === 'loading') {
    return (
      <Section title="Mi cuenta">
        <p role="status" className="mt-2">
          Cargando la sesión…
        </p>
      </Section>
    );
  }

  if (!user) {
    return (
      <Section title="Mi cuenta">
        <p className="mt-2 text-slate-700">Inicia sesión para ver tu historial de donaciones.</p>
        <button
          type="button"
          onClick={() => void login('/cuenta')}
          className="mt-4 rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          Iniciar sesión
        </button>
      </Section>
    );
  }

  return (
    <Section title="Mi cuenta">
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-semibold">Correo</dt>
        <dd>{user.email ?? '—'}</dd>
        <dt className="font-semibold">Roles</dt>
        <dd>{user.groups.length > 0 ? user.groups.join(', ') : 'Sin rol asignado'}</dd>
      </dl>
      <MyDonations user={user} />
    </Section>
  );
}

function MyDonations({ user }: { user: SessionUser }) {
  const query = useQuery({
    queryKey: donationKeys.mine(user.sub),
    queryFn: ({ signal }) =>
      getJson<{ items: DonorDonation[] }>('/v1/donations/me', {
        accessToken: user.accessToken,
        signal,
      }),
  });
  // Nombres de los proyectos para el historial (CA-07.1): el catálogo público ya los tiene.
  const catalog = useQuery({
    queryKey: projectKeys.published,
    queryFn: ({ signal }) => getJson<ProjectList>('/v1/projects', { signal }),
  });
  const titleOf = (projectId: string) =>
    catalog.data?.items.find((project) => project.projectId === projectId)?.title;

  // HU-06: confirmar o rechazar una donación propia pendiente (solo stage academic).
  const queryClient = useQueryClient();
  const simulate = useMutation({
    mutationFn: ({ donationId, outcome }: { donationId: string; outcome: SimulationOutcome }) =>
      sendJson<DonorDonation>('POST', `/v1/donations/${donationId}/simulate`, {
        accessToken: user.accessToken,
        body: { outcome },
      }),
    // El historial y los montos confirmados del catálogo cambian juntos.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: donationKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
      ]),
  });

  return (
    <section aria-labelledby="historial" className="mt-6">
      <h2 id="historial" className="text-lg font-semibold">
        Historial de donaciones
      </h2>
      <p role="note" className="mt-1 text-sm text-amber-900">
        Simulación académica: no se ha realizado ningún cobro.
      </p>
      {simulate.isSuccess && (
        <p role="status" className="mt-2 rounded bg-emerald-50 px-3 py-2 text-emerald-900">
          Donación {STATUS_LABELS[simulate.data.status].toLowerCase()}. Simulación académica: no se
          ha realizado ningún cobro.
        </p>
      )}
      {simulate.isError && (
        <p role="alert" className="mt-2 rounded bg-red-50 px-3 py-2 text-red-800">
          No se pudo simular: {simulate.error.message}
        </p>
      )}
      {query.isPending && (
        <p role="status" className="mt-2">
          Cargando historial…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="mt-2 text-red-800">
          {errorMessage(query.error)}
        </p>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <p className="mt-2 text-slate-700">
          Aún no tienes donaciones. Elige un proyecto en el{' '}
          <Link to="/" className="underline">
            catálogo
          </Link>
          .
        </p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {query.data.items.map((donation) => (
            <li key={donation.donationId} className="grid gap-1 p-3 sm:grid-cols-[1fr_auto]">
              <div>
                <Link
                  to={`/proyectos/${donation.projectId}`}
                  className="font-semibold text-sky-800 underline-offset-2 hover:underline"
                >
                  {titleOf(donation.projectId) ?? 'Proyecto'}
                </Link>
                <p className="text-sm text-slate-600">
                  <time dateTime={donation.createdAt}>{formatDateTime(donation.createdAt)}</time>
                </p>
              </div>
              <div className="sm:text-right">
                <p className="font-semibold">{formatPen(donation.amountCents)}</p>
                <p className="text-sm">{STATUS_LABELS[donation.status]}</p>
              </div>
              {donation.status === 'PENDIENTE_SIMULACION' && (
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  {(
                    [
                      ['CONFIRMADA_SIMULADA', 'Simular confirmación', 'bg-emerald-700'],
                      ['RECHAZADA_SIMULADA', 'Simular rechazo', 'bg-slate-600'],
                    ] as const
                  ).map(([outcome, label, color]) => (
                    <button
                      key={outcome}
                      type="button"
                      disabled={simulate.isPending}
                      onClick={() => {
                        simulate.mutate({ donationId: donation.donationId, outcome });
                      }}
                      aria-label={`${label} de ${formatPen(donation.amountCents)} a ${
                        titleOf(donation.projectId) ?? 'este proyecto'
                      }`}
                      className={`rounded px-3 py-1 text-sm font-semibold text-white disabled:opacity-60 ${color}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Tu cuenta no tiene el rol DONANTE, así que no tiene historial de donaciones.';
  }
  return 'No se pudo cargar el historial. Inténtalo de nuevo más tarde.';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </>
  );
}
