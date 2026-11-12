export const DONATION_STATUSES = [
  'PENDIENTE_SIMULACION',
  'CONFIRMADA_SIMULADA',
  'RECHAZADA_SIMULADA',
] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/** Registro persistido (requirements.md §4). Montos en céntimos enteros de PEN (AD-04). */
export interface Donation {
  donationId: string;
  projectId: string;
  donorSub: string;
  amountCents: number;
  currency: 'PEN';
  status: DonationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lo que ve el propio donante en su historial (HU-07). No incluye `donorSub`: el donante ya
 * sabe quién es y así no se repite el identificador en cada elemento (CA-NF10.1).
 */
export interface DonorDonation {
  donationId: string;
  projectId: string;
  amountCents: number;
  currency: 'PEN';
  status: DonationStatus;
  createdAt: string;
}

export function toDonorDonation(donation: Donation): DonorDonation {
  return {
    donationId: donation.donationId,
    projectId: donation.projectId,
    amountCents: donation.amountCents,
    currency: donation.currency,
    status: donation.status,
    createdAt: donation.createdAt,
  };
}
