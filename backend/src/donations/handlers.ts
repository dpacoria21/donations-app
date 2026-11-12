import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { createAuditor, memoize } from '../audit/auditor.ts';
import { getPseudonymKey } from '../audit/model.ts';
import { createAuditRecorder, type AuditRecorder } from '../audit/recorder.ts';
import { getIdentity, requireGroup, requireScope, SCOPES } from '../authz/identity.ts';
import {
  getProjectRepository,
  InMemoryProjectRepository,
  type ProjectRepository,
} from '../projects/repository.ts';
import { parseJsonBody } from '../shared/body.ts';
import { badRequest, conflict, notFound } from '../shared/errors.ts';
import { json, withHttp, type HttpResult } from '../shared/http.ts';
import { toDonorDonation, type Donation } from './model.ts';
import { getDonationRepository, type DonationRepository } from './repository.ts';
import {
  createDonationSchema,
  donationIdSchema,
  IDEMPOTENCY_TTL_SECONDS,
  idempotencyKeySchema,
  idempotencyPk,
  payloadHash,
  simulateDonationSchema,
} from './schemas.ts';

type DonorEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

export interface DonationHandlerOptions {
  /** Proyectos, para comprobar que existe y está PUBLICADO. Se crea al primer uso. */
  projects?: () => ProjectRepository;
  now?: () => string;
  newId?: () => string;
  auditRecorder?: () => AuditRecorder;
  pseudonymKey?: () => string;
  /** Stage de API Gateway; la simulación solo existe en `academic` (CA-06.1). */
  stage?: () => string;
}

const DONATION_NOT_FOUND = 'Donación no encontrada';

/** Respuesta 201 con la ruta de la donación; `replayed` marca una respuesta repetida. */
function created(donation: Donation, replayed: boolean): HttpResult {
  const response = json(201, toDonorDonation(donation));
  return {
    ...response,
    headers: {
      ...response.headers,
      location: `/v1/donations/${donation.donationId}`,
      ...(replayed ? { 'idempotency-replayed': 'true' } : {}),
    },
  };
}

/** Rutas protegidas de donaciones (DONANTE). La fase 5 añade la simulación. */
export function createDonationHandlers(
  repository: DonationRepository,
  options: DonationHandlerOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? randomUUID;
  const projects = memoize(options.projects ?? getProjectRepository);
  const stage = options.stage ?? (() => process.env.STAGE ?? 'academic');
  const audited = createAuditor({
    now,
    newId,
    recorder: memoize(options.auditRecorder ?? createAuditRecorder),
    pseudonymKey: memoize(options.pseudonymKey ?? getPseudonymKey),
  });

  /**
   * Si la clave ya se usó: con el mismo cuerpo devuelve la respuesta original (sin crear otra
   * donación); con otro cuerpo, 409 (CA-05.4). `null` si la clave es nueva.
   */
  async function replayIfKnown(pk: string, hash: string): Promise<HttpResult | null> {
    const record = await repository.findIdempotency(pk);
    if (!record) return null;
    if (record.payloadHash !== hash) {
      throw conflict('La clave Idempotency-Key ya se usó con otros datos');
    }
    const donation = await repository.findById(record.donationId);
    if (!donation) throw new Error('El registro de idempotencia apunta a una donación inexistente');
    return created(donation, true);
  }

  return {
    /**
     * POST /v1/donations: intención de donación simulada (HU-05). Nunca se piden datos de pago
     * (CA-05.5) y el `donorSub` sale del token, no del cuerpo (CA-05.3).
     */
    createDonation: withHttp('donations.create', (event: DonorEvent) =>
      audited(
        event,
        {
          eventType: 'DONATION_CREATE',
          action: 'donations.create',
          failureResourceRef: () => 'donation/-',
        },
        async (identity, audit) => {
          requireScope(identity, SCOPES.donationsWrite);
          requireGroup(identity, 'DONANTE');

          const key = idempotencyKeySchema.safeParse(event.headers['idempotency-key']);
          if (!key.success) {
            throw badRequest('La cabecera Idempotency-Key es obligatoria y debe ser un UUID');
          }
          const input = parseJsonBody(event, createDonationSchema);
          const hash = payloadHash(input);
          const pk = idempotencyPk(identity.sub, key.data);

          // 1. ¿Es un reintento? Se responde igual que la primera vez, sin crear nada.
          const replay = await replayIfKnown(pk, hash);
          if (replay) return replay;

          // 2. El proyecto debe existir y estar PUBLICADO (CA-05.2). Ningún error toca el acumulado.
          const project = await projects().findById(input.projectId);
          if (!project) throw notFound('Proyecto no encontrado');
          if (project.status !== 'PUBLICADO') {
            throw conflict('El proyecto no está publicado y no acepta donaciones');
          }

          // 3. Clave + donación + comprobación del proyecto + auditoría, en una transacción.
          const timestamp = now();
          const donation: Donation = {
            donationId: newId(),
            projectId: input.projectId,
            donorSub: identity.sub,
            amountCents: input.amountCents,
            currency: 'PEN',
            status: 'PENDIENTE_SIMULACION',
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          const result = await repository.createWithIdempotency({
            donation,
            idempotency: {
              pk,
              payloadHash: hash,
              donationId: donation.donationId,
              responseStatus: 201,
              expiresAt: Math.floor(Date.parse(timestamp) / 1000) + IDEMPOTENCY_TTL_SECONDS,
              createdAt: timestamp,
            },
            // Sin montos ni datos del donante: solo el recurso (CA-10.2).
            audit: audit.success(`donation/${donation.donationId}`),
          });

          if (result === 'KEY_IN_USE') {
            // Otra solicitud con la misma clave ganó la carrera: se repite su respuesta.
            const winner = await replayIfKnown(pk, hash);
            if (winner) return winner;
            throw conflict('La clave Idempotency-Key ya está en uso');
          }
          if (result === 'PROJECT_NOT_PUBLISHED') {
            throw conflict('El proyecto no está publicado y no acepta donaciones');
          }
          return created(donation, false);
        },
      ),
    ),

    /**
     * GET /v1/donations/me: historial propio (HU-07). API Gateway ya verificó el access token
     * y el scope `api/donations.read`; aquí se exige además el grupo DONANTE y se filtra por
     * el `sub` del token, nunca por un parámetro del cliente (CA-04.2, CA-04.3).
     */
    getMyDonations: withHttp('donations.listMine', async (event: DonorEvent) => {
      const identity = getIdentity(event);
      requireScope(identity, SCOPES.donationsRead);
      requireGroup(identity, 'DONANTE');
      const donations = await repository.listByDonor(identity.sub);
      return json(200, { items: donations.map(toDonorDonation) });
    }),

    /**
     * GET /v1/donations/{donationId} (decisión D1): solo la propia. Una donación ajena responde
     * igual que una inexistente, 404, para no revelar que existe (CA-07.2, T09, OWASP API1).
     */
    getDonation: withHttp('donations.get', async (event: DonorEvent) => {
      const identity = getIdentity(event);
      requireScope(identity, SCOPES.donationsRead);
      requireGroup(identity, 'DONANTE');
      const id = donationIdSchema.safeParse(event.pathParameters?.donationId);
      if (!id.success) throw notFound(DONATION_NOT_FOUND);
      const donation = await repository.findById(id.data);
      if (donation?.donorSub !== identity.sub) throw notFound(DONATION_NOT_FOUND);
      return json(200, toDonorDonation(donation));
    }),

    /**
     * POST /v1/donations/{donationId}/simulate (HU-06): la persona confirma o rechaza su propia
     * donación pendiente. Solo existe en el stage `academic` (CA-06.1): la plantilla no crea la
     * ruta en otro stage y, por si acaso, el handler responde 404 fuera de él.
     */
    simulateDonation: withHttp('donations.simulate', async (event: DonorEvent) => {
      if (stage() !== 'academic') throw notFound('Ruta no encontrada');
      const target = event.pathParameters?.donationId;
      return audited(
        event,
        {
          eventType: 'DONATION_SIMULATE',
          action: 'donations.simulate',
          failureResourceRef: () =>
            donationIdSchema.safeParse(target).success
              ? `donation/${String(target)}`
              : 'donation/-',
        },
        async (identity, audit) => {
          requireScope(identity, SCOPES.donationsWrite);
          requireGroup(identity, 'DONANTE');
          const id = donationIdSchema.safeParse(target);
          if (!id.success) throw notFound(DONATION_NOT_FOUND);
          const { outcome } = parseJsonBody(event, simulateDonationSchema);

          // Ownership contra el registro guardado (CA-NF02.2): una ajena es 404, como en D1.
          const donation = await repository.findById(id.data);
          if (donation?.donorSub !== identity.sub) throw notFound(DONATION_NOT_FOUND);
          if (donation.status !== 'PENDIENTE_SIMULACION') {
            throw conflict('La donación ya fue simulada');
          }

          const result = await repository.simulate({
            donation,
            outcome,
            now: now(),
            // Sin montos: solo el recurso y el resultado de la operación (CA-10.2).
            audit: audit.success(`donation/${donation.donationId}`, ['status']),
          });
          // Otra solicitud la simuló entre la lectura y la escritura: no se suma dos veces.
          if (!result.ok) throw conflict('La donación ya fue simulada');
          return json(200, toDonorDonation(result.donation));
        },
      );
    }),
  };
}

// Puntos de entrada de Lambda; cada función tiene su propio rol IAM en SAM. En local, las
// donaciones en memoria consultan el estado de los proyectos de prueba.
export const { createDonation, getMyDonations, getDonation, simulateDonation } =
  createDonationHandlers(
    getDonationRepository({
      projectStatus: async (projectId) =>
        (await getProjectRepository().findById(projectId))?.status,
      addConfirmed: (projectId, amountCents) => {
        const local = getProjectRepository();
        if (local instanceof InMemoryProjectRepository) local.addConfirmed(projectId, amountCents);
      },
    }),
  );
