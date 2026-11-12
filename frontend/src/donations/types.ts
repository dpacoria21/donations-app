/** Donación tal como la devuelve el API (`DonorDonation` en docs/api.yaml). */
export interface DonorDonation {
  donationId: string;
  projectId: string;
  amountCents: number;
  currency: 'PEN';
  status: 'PENDIENTE_SIMULACION' | 'CONFIRMADA_SIMULADA' | 'RECHAZADA_SIMULADA';
  createdAt: string;
}

export const STATUS_LABELS: Record<DonorDonation['status'], string> = {
  PENDIENTE_SIMULACION: 'Pendiente de simulación',
  CONFIRMADA_SIMULADA: 'Confirmada (simulada)',
  RECHAZADA_SIMULADA: 'Rechazada (simulada)',
};

/** Invalidar `['donations']` refresca el historial tras donar. */
export const donationKeys = {
  all: ['donations'] as const,
  mine: (sub: string) => ['donations', 'me', sub] as const,
};
