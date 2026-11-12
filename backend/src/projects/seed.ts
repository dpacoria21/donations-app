import type { Project } from './model.ts';

/** Proyectos ficticios para desarrollo local. Ninguno corresponde a una campaña real. */
export const SEED_PROJECTS: readonly Project[] = [
  {
    projectId: '3f6c2a1e-8b4d-4c7a-9e21-5a0d7b3c9f10',
    title: 'Útiles escolares para Characato',
    description: 'Kits de útiles para estudiantes de primaria de escuelas rurales.',
    goalAmountCents: 1_500_000,
    confirmedAmountCents: 425_000,
    currency: 'PEN',
    status: 'PUBLICADO',
    createdAt: '2026-11-03T14:00:00.000Z',
    updatedAt: '2026-11-08T09:30:00.000Z',
  },
  {
    projectId: '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63',
    title: 'Comedor popular de Alto Selva Alegre',
    description: 'Raciones diarias de almuerzo para familias del comedor comunitario.',
    goalAmountCents: 800_000,
    confirmedAmountCents: 612_550,
    currency: 'PEN',
    status: 'PUBLICADO',
    createdAt: '2026-11-04T16:20:00.000Z',
    updatedAt: '2026-11-09T18:45:00.000Z',
  },
  {
    projectId: 'c25e8f73-9a1b-4d06-8f4e-6b3a2c1d0e95',
    title: 'Campaña de salud visual en Cerro Colorado',
    description: 'Evaluaciones oftalmológicas y lentes para adultos mayores.',
    goalAmountCents: 1_200_000,
    confirmedAmountCents: 0,
    currency: 'PEN',
    status: 'PUBLICADO',
    createdAt: '2026-11-05T11:10:00.000Z',
    updatedAt: '2026-11-05T11:10:00.000Z',
  },
  {
    projectId: 'e8d4b6a2-5c3f-4e19-b7a0-9f1c2d3e4b58',
    title: 'Biblioteca itinerante (borrador)',
    description: 'Proyecto en preparación; no debe aparecer en el catálogo público.',
    goalAmountCents: 600_000,
    confirmedAmountCents: 0,
    currency: 'PEN',
    status: 'BORRADOR',
    createdAt: '2026-11-06T08:00:00.000Z',
    updatedAt: '2026-11-06T08:00:00.000Z',
  },
];
