import { useInfiniteQuery } from '@tanstack/react-query';
import { useId, useState, type SyntheticEvent } from 'react';
import { ApiError, getJson } from '../api/client.ts';
import {
  AUDIT_EVENT_TYPES,
  auditSearchParams,
  EVENT_TYPE_LABELS,
  OUTCOME_LABELS,
  type AuditEventList,
  type AuditFilters,
} from '../audit/types.ts';
import { useAuth, type SessionUser } from '../auth/context.ts';
import { inputClass } from '../components/FormField.tsx';
import { PageTitle } from '../components/PageTitle.tsx';
import { SignInPrompt } from '../components/SignInPrompt.tsx';
import { formatDateTime } from '../lib/format.ts';

const EMPTY: AuditFilters = { eventType: '', from: '', to: '' };

/**
 * Consulta de auditoría (HU-10). Ocultar el enlace no protege nada: el API exige el grupo
 * AUDITOR y Cognito no emite tokens a un AUDITOR sin MFA.
 */
export function AuditPage() {
  const { user } = useAuth();
  if (!user) {
    return (
      <SignInPrompt
        title="Auditoría"
        message="Inicia sesión con una cuenta de auditor (con MFA) para consultar los eventos."
      />
    );
  }
  return <AuditEvents user={user} />;
}

function AuditEvents({ user }: { user: SessionUser }) {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const query = useInfiniteQuery({
    queryKey: ['audit', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getJson<AuditEventList>(`/v1/audit?${auditSearchParams(filters, pageParam).toString()}`, {
        accessToken: user.accessToken,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageTitle>Auditoría</PageTitle>
      <h1 className="text-2xl font-bold">Auditoría</h1>
      <p className="mt-2 text-slate-700">
        Acciones críticas registradas. El actor es un seudónimo: no se muestran correos, tokens ni
        montos.
      </p>

      <FilterForm initial={filters} onSearch={setFilters} />

      {query.isPending && (
        <p role="status" className="mt-6">
          Cargando eventos…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="mt-6 text-red-800">
          {errorMessage(query.error)}
        </p>
      )}
      {query.isSuccess && events.length === 0 && (
        <p role="status" className="mt-6 text-slate-700">
          No hay eventos con esos filtros.
        </p>
      )}
      {events.length > 0 && (
        <>
          <p role="status" className="mt-6 text-sm text-slate-700">
            {events.length === 1 ? '1 evento' : `${String(events.length)} eventos`}
            {query.hasNextPage ? ' (hay más)' : ''}
          </p>
          <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {events.map((event) => (
              <li key={event.eventId} className="p-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{EVENT_TYPE_LABELS[event.eventType]}</span>
                  <OutcomeBadge outcome={event.outcome} />
                </p>
                <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 text-sm">
                  <dt className="text-slate-600">Fecha</dt>
                  <dd>
                    <time dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time>
                  </dd>
                  <dt className="text-slate-600">Acción</dt>
                  <dd className="font-mono text-xs break-all">{event.action}</dd>
                  <dt className="text-slate-600">Recurso</dt>
                  <dd className="font-mono text-xs break-all">{event.resourceRef}</dd>
                  <dt className="text-slate-600">Actor</dt>
                  <dd className="font-mono text-xs break-all">
                    {event.actorRef} ({event.actorRole ?? 'sin rol'})
                  </dd>
                  {event.changedFields && (
                    <>
                      <dt className="text-slate-600">Campos</dt>
                      <dd>{event.changedFields.join(', ')}</dd>
                    </>
                  )}
                  <dt className="text-slate-600">Solicitud</dt>
                  <dd className="font-mono text-xs break-all">{event.requestId}</dd>
                </dl>
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="mt-4 rounded border border-sky-700 px-4 py-2 font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-60"
            >
              {query.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </button>
          )}
        </>
      )}
    </>
  );
}

function FilterForm({
  initial,
  onSearch,
}: {
  initial: AuditFilters;
  onSearch: (filters: AuditFilters) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const invalidRange = draft.from !== '' && draft.to !== '' && draft.from > draft.to;

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!invalidRange) onSearch(draft);
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Filtros de auditoría"
      className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
    >
      <div>
        <label htmlFor={`${id}-tipo`} className="font-semibold">
          Tipo de evento
        </label>
        <select
          id={`${id}-tipo`}
          value={draft.eventType}
          onChange={(event) => {
            setDraft({ ...draft, eventType: event.target.value as AuditFilters['eventType'] });
          }}
          className={inputClass}
        >
          <option value="">Todos</option>
          {AUDIT_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-desde`} className="font-semibold">
          Desde
        </label>
        <input
          id={`${id}-desde`}
          type="date"
          value={draft.from}
          onChange={(event) => {
            setDraft({ ...draft, from: event.target.value });
          }}
          aria-invalid={invalidRange}
          aria-describedby={invalidRange ? `${id}-rango` : undefined}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-hasta`} className="font-semibold">
          Hasta
        </label>
        <input
          id={`${id}-hasta`}
          type="date"
          value={draft.to}
          onChange={(event) => {
            setDraft({ ...draft, to: event.target.value });
          }}
          aria-invalid={invalidRange}
          aria-describedby={invalidRange ? `${id}-rango` : undefined}
          className={inputClass}
        />
      </div>
      {invalidRange && (
        <p id={`${id}-rango`} role="alert" className="text-sm text-red-800 sm:col-span-3">
          La fecha «Desde» debe ser anterior o igual a «Hasta».
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <button
          type="submit"
          className="rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-800"
        >
          Buscar
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY);
            onSearch(EMPTY);
          }}
          className="rounded border border-slate-400 px-4 py-2 font-semibold text-slate-800 hover:bg-slate-100"
        >
          Limpiar filtros
        </button>
      </div>
    </form>
  );
}

function OutcomeBadge({ outcome }: { outcome: keyof typeof OUTCOME_LABELS }) {
  const color =
    outcome === 'SUCCESS'
      ? 'bg-emerald-100 text-emerald-900'
      : outcome === 'DENIED'
        ? 'bg-red-100 text-red-900'
        : 'bg-amber-100 text-amber-900';
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${color}`}>
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Solo las cuentas con rol AUDITOR pueden consultar la auditoría.';
  }
  if (error instanceof ApiError && error.status === 400) {
    return `Filtros inválidos: ${error.message}`;
  }
  return 'No se pudieron cargar los eventos. Inténtalo de nuevo más tarde.';
}
