import { useId, type ReactNode } from 'react';
import type { FieldError } from 'react-hook-form';

export const inputClass =
  'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-sky-700 aria-invalid:border-red-700';

export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

/** Etiqueta, ayuda y error asociados al control para lectores de pantalla (CA-NF06.2). */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error: FieldError | undefined;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error?.message && (
        <p id={errorId} className="mt-1 text-sm text-red-800">
          {error.message}
        </p>
      )}
    </div>
  );
}
