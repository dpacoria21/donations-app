import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevServer } from '../dev/app.ts';

const server = createDevServer();
let baseUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('servidor local de desarrollo', () => {
  it('sirve la página del catálogo con cabeceras de seguridad', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('Proyectos sociales');
  });

  it('enruta /v1/projects al handler Lambda', async () => {
    const response = await fetch(`${baseUrl}/v1/projects`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(3);
  });

  it('extrae el parámetro {projectId} de la ruta', async () => {
    const response = await fetch(
      `${baseUrl}/v1/projects/7a91d0c4-2e5f-4b38-a6c7-1d9e8f2b4a63/stats`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ progressPercent: 76 });
  });

  it('una ruta de API inexistente devuelve 404 JSON', async () => {
    const response = await fetch(`${baseUrl}/v1/donations`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['/..%2fpackage.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/%E0%A4%A'])(
    'no permite salir de public/ (%s)',
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(404);
    },
  );

  it('rechaza métodos distintos de GET en las páginas', async () => {
    const response = await fetch(`${baseUrl}/index.html`, { method: 'POST' });
    expect(response.status).toBe(405);
  });
});
