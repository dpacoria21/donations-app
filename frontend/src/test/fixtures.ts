import type { Project } from '../projects/types.ts';

export const PUBLISHED: Project = {
  projectId: '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63',
  title: 'Comedor popular de Alto Selva Alegre',
  description: 'Raciones diarias de almuerzo para familias del comedor comunitario.',
  goalAmountCents: 800_000,
  confirmedAmountCents: 612_550,
  currency: 'PEN',
  status: 'PUBLICADO',
  updatedAt: '2026-11-09T18:45:00.000Z',
};

export const DRAFT: Project = {
  projectId: 'e8d4b6a2-5c3f-4e19-b7a0-9f1c2d3e4b58',
  title: 'Biblioteca itinerante',
  description: 'Proyecto en preparación; no debe aparecer en el catálogo público.',
  goalAmountCents: 600_000,
  confirmedAmountCents: 0,
  currency: 'PEN',
  status: 'BORRADOR',
  updatedAt: '2026-11-06T08:00:00.000Z',
};
