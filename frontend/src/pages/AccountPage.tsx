import { useQuery } from '@tanstack/react-query';
import { ApiError, getJson } from '../api/client.ts';
import { useAuth, type SessionUser } from '../auth/context.ts';

interface DonorDonation {
  donationId: string;
  projectId: string;
  amountCents: number;
  currency: 'PEN';
  status: 'PENDIENTE_SIMULACION' | 'CONFIRMADA_SIMULADA' | 'RECHAZADA_SIMULADA';
  createdAt: string;
}

const STATUS_LABELS: Record<DonorDonation['status'], string> = {
  PENDIENTE_SIMULACION: 'Pendiente de simulación',
  CONFIRMADA_SIMULADA: 'Confirmada (simulada)',
  RECHAZADA_SIMULADA: 'Rechazada (simulada)',
};

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const date = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

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
    queryKey: ['donations', 'me', user.sub],
    queryFn: ({ signal }) =>
      getJson<{ items: DonorDonation[] }>('/v1/donations/me', {
        accessToken: user.accessToken,
        signal,
      }),
  });

  return (
    <section aria-labelledby="historial" className="mt-6">
      <h2 id="historial" className="text-lg font-semibold">
        Historial de donaciones
      </h2>
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
        <p className="mt-2 text-slate-700">Aún no tienes donaciones.</p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {query.data.items.map((donation) => (
            <li key={donation.donationId} className="flex flex-wrap justify-between gap-2 p-3">
              <span className="font-semibold">{money.format(donation.amountCents / 100)}</span>
              <span>{STATUS_LABELS[donation.status]}</span>
              <span className="text-sm text-slate-600">
                {date.format(new Date(donation.createdAt))}
              </span>
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
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </>
  );
}
