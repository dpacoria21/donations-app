import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevServer } from '../dev/app.ts';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const server = createDevServer({ allowedOrigins: [FRONTEND_ORIGIN] });
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

describe('servidor local del API', () => {
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

  it.each(['/', '/index.html', '/v1/donations'])(
    'ya no sirve páginas: %s devuelve 404 JSON',
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    },
  );
});

describe('CORS para el frontend', () => {
  it('añade el origen permitido a las respuestas', async () => {
    const response = await fetch(`${baseUrl}/v1/projects`, {
      headers: { origin: FRONTEND_ORIGIN },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(FRONTEND_ORIGIN);
  });

  it('no concede CORS a otros orígenes', async () => {
    const response = await fetch(`${baseUrl}/v1/projects`, {
      headers: { origin: 'https://atacante.example' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responde al preflight con métodos y cabeceras permitidos', async () => {
    const response = await fetch(`${baseUrl}/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: FRONTEND_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(response.headers.get('access-control-allow-headers')).toContain('idempotency-key');
  });
});
