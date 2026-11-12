import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { getIdentity, requireGroup, requireScope, SCOPES } from '../authz/identity.ts';
import { json, withHttp } from '../shared/http.ts';
import { toDonorDonation } from './model.ts';
import { getDonationRepository, type DonationRepository } from './repository.ts';

/** Rutas protegidas de donaciones. La fase 4 añade la creación y la simulación. */
export function createDonationHandlers(repository: DonationRepository) {
  return {
    /**
     * GET /v1/donations/me: historial propio (HU-07). API Gateway ya verificó el access token
     * y el scope `api/donations.read`; aquí se exige además el grupo DONANTE y se filtra por
     * el `sub` del token, nunca por un parámetro del cliente (CA-04.2, CA-04.3).
     */
    getMyDonations: withHttp(
      'donations.listMine',
      async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
        const identity = getIdentity(event);
        requireScope(identity, SCOPES.donationsRead);
        requireGroup(identity, 'DONANTE');
        const donations = await repository.listByDonor(identity.sub);
        return json(200, { items: donations.map(toDonorDonation) });
      },
    ),
  };
}

// Puntos de entrada de Lambda; cada función tiene su propio rol IAM en SAM.
export const { getMyDonations } = createDonationHandlers(getDonationRepository());
