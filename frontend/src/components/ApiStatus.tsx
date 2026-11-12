import { useEffect, useState } from 'react';
import { config } from '../config.ts';

type Status =
  { kind: 'loading' } | { kind: 'ok'; projects: number } | { kind: 'error'; message: string };

/** Comprobación temporal de la conexión con el backend (GET /v1/projects). */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${config.apiBaseUrl}/v1/projects`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const body = (await response.json()) as { items: unknown[] };
        setStatus({ kind: 'ok', projects: body.items.length });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'error desconocido',
        });
      });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <section
      aria-labelledby="api-status-title"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="api-status-title" className="font-semibold">
        Conexión con el API
      </h2>
      <p role="status" aria-live="polite" className="mt-1 text-sm">
        {status.kind === 'loading' && 'Comprobando…'}
        {status.kind === 'ok' &&
          `Conectado: ${String(status.projects)} proyectos publicados en ${config.apiBaseUrl}.`}
        {status.kind === 'error' &&
          `No se pudo conectar con ${config.apiBaseUrl} (${status.message}). ¿Está corriendo el backend?`}
      </p>
    </section>
  );
}
