import { formatPen, progressPercent } from '../lib/format.ts';

interface ProjectProgressProps {
  confirmedAmountCents: number;
  goalAmountCents: number;
  /** Si el API ya lo calculó (`/stats`), se usa ese valor. */
  percent?: number;
}

/**
 * Avance del monto confirmado (simulado) frente a la meta, en PEN (CA-09.1). Usa `<progress>`
 * nativo: es accesible sin roles extra y no necesita estilos en línea, que la CSP de
 * CloudFront bloquea (`style-src 'self'`, CA-NF11.2).
 */
export function ProjectProgress({
  confirmedAmountCents,
  goalAmountCents,
  percent = progressPercent(confirmedAmountCents, goalAmountCents),
}: ProjectProgressProps) {
  const label = `${formatPen(confirmedAmountCents)} de ${formatPen(goalAmountCents)}`;
  return (
    <div className="mt-3">
      <progress
        max={100}
        value={percent}
        aria-label="Avance de la meta"
        aria-valuenow={percent}
        aria-valuetext={`${String(percent)} %: ${label}`}
        className="h-2 w-full appearance-none overflow-hidden rounded-full bg-slate-200 [&::-moz-progress-bar]:bg-emerald-600 [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:bg-emerald-600"
      />
      <p className="mt-1 text-sm text-slate-700">
        <span className="font-semibold">{formatPen(confirmedAmountCents)}</span> recaudados de{' '}
        {formatPen(goalAmountCents)} ({percent} %)
      </p>
    </div>
  );
}
