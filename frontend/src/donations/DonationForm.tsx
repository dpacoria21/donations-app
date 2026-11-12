import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { ApiError, sendJson } from '../api/client.ts';
import type { SessionUser } from '../auth/context.ts';
import { Field, inputClass } from '../components/FormField.tsx';
import { formatPen, solesToCents } from '../lib/format.ts';
import { donationFormSchema, type DonationFormValues } from './schemas.ts';
import { donationKeys, type DonorDonation } from './types.ts';

interface Intention {
  amountCents: number;
  idempotencyKey: string;
}

/**
 * Formulario de intención de donación (HU-05). Cada intención lleva una `Idempotency-Key`
 * propia: si la respuesta no llega y la persona vuelve a enviar el mismo monto, se reutiliza la
 * clave y el API devuelve la misma donación en lugar de crear otra (CA-05.4). Al cambiar el
 * monto o tras una donación exitosa, la siguiente intención usa una clave nueva.
 */
export function DonationForm({ projectId, user }: { projectId: string; user: SessionUser }) {
  const queryClient = useQueryClient();
  const pending = useRef<Intention | null>(null);
  const form = useForm<DonationFormValues>({
    resolver: zodResolver(donationFormSchema),
    defaultValues: { amount: '' },
  });

  const donate = useMutation({
    mutationFn: (intention: Intention) =>
      sendJson<DonorDonation>('POST', '/v1/donations', {
        accessToken: user.accessToken,
        headers: { 'Idempotency-Key': intention.idempotencyKey },
        body: { projectId, amountCents: intention.amountCents },
      }),
    onSuccess: async () => {
      pending.current = null;
      form.reset();
      await queryClient.invalidateQueries({ queryKey: donationKeys.all });
    },
    onError: (error) => {
      // Un rechazo definitivo (4xx) cierra la intención; un fallo de red o 5xx la conserva para
      // reintentar con la misma clave.
      if (error instanceof ApiError && error.status < 500) pending.current = null;
    },
  });

  // Solo se ejecuta al enviar el formulario (nunca durante el render).
  function submit(values: DonationFormValues) {
    const amountCents = solesToCents(values.amount);
    if (amountCents === null) return;
    if (pending.current?.amountCents !== amountCents) {
      pending.current = { amountCents, idempotencyKey: crypto.randomUUID() };
    }
    donate.mutate(pending.current);
  }

  const { errors } = form.formState;
  return (
    <section
      aria-labelledby="donar"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="donar" className="font-semibold">
        Donar a este proyecto
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        No pedimos datos de tarjeta, cuenta bancaria ni documentos: solo el monto.
      </p>

      {donate.isSuccess && (
        <div role="status" className="mt-3 rounded bg-emerald-50 px-3 py-2 text-emerald-900">
          <p className="font-semibold">
            Intención registrada por {formatPen(donate.data.amountCents)}: pendiente de simulación.
          </p>
          <p className="text-sm">Simulación académica: no se ha realizado ningún cobro.</p>
          <Link to="/cuenta" className="text-sm underline">
            Ver mi historial
          </Link>
        </div>
      )}
      {donate.isError && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-red-800">
          {errorMessage(donate.error)}
        </p>
      )}

      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="mt-3 flex flex-wrap items-start gap-3"
      >
        <div className="min-w-48 flex-1">
          <Field
            label="Monto en soles (S/)"
            hint="Entre S/ 1.00 y S/ 1,000.00"
            error={errors.amount}
          >
            {(props) => (
              <input
                {...props}
                {...form.register('amount')}
                inputMode="decimal"
                autoComplete="off"
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <button
          type="submit"
          disabled={donate.isPending}
          className="mt-7 rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60"
        >
          {donate.isPending ? 'Registrando…' : 'Registrar intención'}
        </button>
      </form>
    </section>
  );
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    if (error.status === 403) return 'Solo las cuentas con rol DONANTE pueden donar.';
    if (error.status === 404) return 'El proyecto ya no existe.';
    if (error.status < 500) return error.message;
  }
  return 'No se pudo registrar la intención. Vuelve a intentarlo: no se duplicará.';
}
