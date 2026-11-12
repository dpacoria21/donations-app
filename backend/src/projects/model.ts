export const PROJECT_STATUSES = ['BORRADOR', 'PUBLICADO'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Registro persistido (requirements.md §4). Los montos son céntimos enteros de PEN. */
export interface Project {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: 'PEN';
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Vista pública: sin datos de donantes ni registros individuales (CA-02.1, CA-09.2).
 * `updatedAt` permite mostrar «Última actualización» si una campaña se edita (decisión D2).
 */
export interface PublicProject {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: 'PEN';
  status: ProjectStatus;
  updatedAt: string;
}

export interface ProjectStats {
  projectId: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: 'PEN';
  progressPercent: number;
}

export function toPublicProject(project: Project): PublicProject {
  return {
    projectId: project.projectId,
    title: project.title,
    description: project.description,
    goalAmountCents: project.goalAmountCents,
    confirmedAmountCents: project.confirmedAmountCents,
    currency: project.currency,
    status: project.status,
    updatedAt: project.updatedAt,
  };
}

/** Solo usa el acumulado confirmado: pendientes y rechazadas no cuentan (CA-09.1). */
export function toProjectStats(project: Project): ProjectStats {
  const { goalAmountCents, confirmedAmountCents } = project;
  const progressPercent =
    goalAmountCents > 0
      ? Math.min(100, Math.floor((confirmedAmountCents * 100) / goalAmountCents))
      : 0;
  return {
    projectId: project.projectId,
    goalAmountCents,
    confirmedAmountCents,
    currency: project.currency,
    progressPercent,
  };
}
