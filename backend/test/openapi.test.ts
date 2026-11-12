import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROUTES } from '../dev/app.ts';
import { createDonationHandlers } from '../src/donations/handlers.ts';
import type { Donation } from '../src/donations/model.ts';
import { InMemoryDonationRepository } from '../src/donations/repository.ts';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import { InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import { donorClaims, httpEvent, jwtEvent } from './helpers/events.ts';

interface Schema {
  required?: string[];
  properties?: Record<string, unknown>;
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Schema> };
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

const spec = parse(
  readFileSync(new URL('../../docs/api.yaml', import.meta.url), 'utf8'),
) as OpenApiDocument;

const documented = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.keys(item)
    .filter((key) => HTTP_METHODS.has(key))
    .map((method) => `${method.toUpperCase()} ${path}`),
);
const implemented = ROUTES.map((route) => route.routeKey);

const schemaKeys = (name: string) =>
  Object.keys(spec.components.schemas[name]?.properties ?? {}).sort();

describe('docs/api.yaml (contrato OpenAPI)', () => {
  it('es OpenAPI 3.1', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
  });

  it('documenta todas las rutas implementadas', () => {
    expect(documented.filter((routeKey) => !implemented.includes(routeKey))).toEqual([]);
    expect(implemented.filter((routeKey) => !documented.includes(routeKey))).toEqual([]);
  });

  it('cada ruta declara la misma seguridad que el servidor local y la plantilla SAM', () => {
    for (const route of ROUTES) {
      const [method = '', path = ''] = route.routeKey.split(' ');
      const operation = spec.paths[path]?.[method.toLowerCase()] as
        { security?: Record<string, string[]>[] } | undefined;
      const expected = route.auth ? [{ cognito: [...route.auth.scopes] }] : [];
      expect(operation?.security, route.routeKey).toEqual(expected);
    }
  });

  describe('las respuestas reales coinciden con los esquemas', () => {
    const handlers = createProjectHandlers(new InMemoryProjectRepository(SEED_PROJECTS));
    const projectId = '7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63';
    const json = (body: string | undefined) =>
      JSON.parse(body ?? 'null') as Record<string, unknown>;

    it('PublicProject', async () => {
      const result = await handlers.getProject(httpEvent({ pathParameters: { projectId } }));
      expect(Object.keys(json(result.body)).sort()).toEqual(schemaKeys('PublicProject'));
    });

    it('ProjectStats', async () => {
      const result = await handlers.getProjectStats(httpEvent({ pathParameters: { projectId } }));
      expect(Object.keys(json(result.body)).sort()).toEqual(schemaKeys('ProjectStats'));
    });

    it('DonorDonation', async () => {
      const donation: Donation = {
        donationId: '0d6f8a10-0000-4000-8000-000000000001',
        projectId,
        donorSub: donorClaims().sub ?? '',
        amountCents: 2_500,
        currency: 'PEN',
        status: 'PENDIENTE_SIMULACION',
        createdAt: '2026-11-11T09:00:00.000Z',
        updatedAt: '2026-11-11T09:00:00.000Z',
      };
      const { getMyDonations } = createDonationHandlers(new InMemoryDonationRepository([donation]));
      const result = await getMyDonations(jwtEvent(donorClaims()));
      const [item] = json(result.body).items as Record<string, unknown>[];
      expect(Object.keys(item ?? {}).sort()).toEqual(schemaKeys('DonorDonation'));
    });

    it('Error', async () => {
      const result = await handlers.getProject(httpEvent({ pathParameters: { projectId: 'x' } }));
      expect(Object.keys(json(result.body)).sort()).toEqual(schemaKeys('Error'));
    });
  });
});
