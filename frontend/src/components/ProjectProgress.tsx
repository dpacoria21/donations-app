import { formatPen, progressPercent } from '../lib/format.ts';

interface ProjectProgressProps {
  confirmedAmountCents: number;
  goalAmountCents: number;
  /** Si el API ya lo calculó (`/stats`), se usa ese valor. */
  percent?: number;
}

/** Barra accesible con el monto confirmado (simulado) frente a la meta, en PEN (CA-09.1). */
export function ProjectProgress({
  confirmedAmountCents,
  goalAmountCents,
  percent = progressPercent(confirmedAmountCents, goalAmountCents),
}: ProjectProgressProps) {
  const label = `${formatPen(confirmedAmountCents)} de ${formatPen(goalAmountCents)}`;
  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-label="Avance de la meta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${String(percent)} %: ${label}`}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-emerald-600"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-slate-700">
        <span className="font-semibold">{formatPen(confirmedAmountCents)}</span> recaudados de{' '}
        {formatPen(goalAmountCents)} ({percent} %)
      </p>
    </div>
  );
}
