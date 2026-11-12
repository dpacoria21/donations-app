import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROUTES } from '../dev/app.ts';
import { createProjectHandlers } from '../src/projects/handlers.ts';
import { InMemoryProjectRepository } from '../src/projects/repository.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';
import { httpEvent } from './helpers/events.ts';

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

    it('Error', async () => {
      const result = await handlers.getProject(httpEvent({ pathParameters: { projectId: 'x' } }));
      expect(Object.keys(json(result.body)).sort()).toEqual(schemaKeys('Error'));
    });
  });
});
