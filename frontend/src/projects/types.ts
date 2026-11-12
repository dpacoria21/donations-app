/** Vista de un proyecto que devuelve el API (`PublicProject` en docs/api.yaml). */
export interface Project {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: 'PEN';
  status: 'BORRADOR' | 'PUBLICADO';
  /** Desde la fase 3. Opcional para tolerar un API desplegado anterior. */
  updatedAt?: string;
}

export interface ProjectList {
  items: Project[];
}

export interface ProjectStats {
  projectId: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: 'PEN';
  progressPercent: number;
}

/** Claves de TanStack Query: invalidar `['projects']` refresca catálogo, detalle y gestión. */
export const projectKeys = {
  all: ['projects'] as const,
  published: ['projects', 'published'] as const,
  detail: (projectId: string) => ['projects', 'detail', projectId] as const,
  stats: (projectId: string) => ['projects', 'stats', projectId] as const,
  managed: ['projects', 'managed'] as const,
};
