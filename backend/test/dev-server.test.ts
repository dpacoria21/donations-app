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

describe('rutas protegidas: imitación del JWT authorizer (T02, T11)', () => {
  // Verificador falso: en `npm run dev` se usa aws-jwt-verify contra el user pool real.
  const TOKENS: Record<string, Record<string, unknown>> = {
    'access-donante': {
      sub: 'b1f0c2d3-0000-4000-8000-000000000001',
      token_use: 'access',
      scope: 'openid email api/donations.read',
      'cognito:groups': ['DONANTE'],
    },
    'access-sin-scope': {
      sub: 'b1f0c2d3-0000-4000-8000-000000000001',
      token_use: 'access',
      scope: 'openid email',
      'cognito:groups': ['DONANTE'],
    },
    'id-donante': {
      sub: 'b1f0c2d3-0000-4000-8000-000000000001',
      token_use: 'id',
      email: 'donante@example.com',
      'cognito:groups': ['DONANTE'],
    },
  };
  const verifyToken = (token: string) => {
    const claims = TOKENS[token];
    return claims ? Promise.resolve(claims) : Promise.reject(new Error('firma inválida'));
  };

  const secured = createDevServer({ verifyToken });
  const unconfigured = createDevServer();
  let securedUrl = '';
  let unconfiguredUrl = '';

  beforeAll(async () => {
    const listen = (srv: typeof secured) =>
      new Promise<string>((resolve) => {
        srv.listen(0, '127.0.0.1', () => {
          resolve(`http://127.0.0.1:${String((srv.address() as AddressInfo).port)}`);
        });
      });
    securedUrl = await listen(secured);
    unconfiguredUrl = await listen(unconfigured);
  });

  afterAll(async () => {
    await new Promise((resolve) => secured.close(resolve));
    await new Promise((resolve) => unconfigured.close(resolve));
  });

  const getMine = (url: string, token?: string) =>
    fetch(`${url}/v1/donations/me`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  it('sin token: 401 con el formato nativo de API Gateway (T02)', async () => {
    const response = await getMine(securedUrl);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
  });

  it('token alterado o de otro user pool: 401 (T11)', async () => {
    expect((await getMine(securedUrl, 'eyJhbGciOiJSUzI1NiJ9.e30.alterado')).status).toBe(401);
  });

  it('ID token: pasa la firma pero no tiene scope, 403 como en HTTP API (T11, D4)', async () => {
    const response = await getMine(securedUrl, 'id-donante');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'Forbidden' });
  });

  it('access token sin el scope de la ruta: 403', async () => {
    expect((await getMine(securedUrl, 'access-sin-scope')).status).toBe(403);
  });

  it('access token válido de un DONANTE: 200 con su historial', async () => {
    const response = await getMine(securedUrl, 'access-donante');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it('sin Cognito configurado no hay atajos: 401', async () => {
    expect((await getMine(unconfiguredUrl, 'access-donante')).status).toBe(401);
  });
});

describe('rutas de gestión en el servidor local (T03)', () => {
  const claimsFor = (group: string) => ({
    sub: `b1f0c2d3-0000-4000-8000-0000000000${group === 'GESTOR' ? '0a' : '0b'}`,
    token_use: 'access',
    scope: 'openid api/projects.write',
    'cognito:groups': [group],
  });
  const server = createDevServer({
    verifyToken: (token) => Promise.resolve(claimsFor(token === 'gestor' ? 'GESTOR' : 'DONANTE')),
  });
  let url = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const create = (token: string) =>
    fetch(`${url}/v1/projects`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Huertos escolares en Paucarpata',
        description: 'Semillas, herramientas y capacitación para huertos escolares.',
        goalAmountCents: 300_000,
      }),
    });

  it('el cuerpo JSON llega al handler y un GESTOR crea el proyecto: 201', async () => {
    const response = await create('gestor');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'BORRADOR' });
  });

  it('T03: un DONANTE con el mismo scope recibe 403 desde la Lambda', async () => {
    const response = await create('donante');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rechaza cuerpos demasiado grandes: 413', async () => {
    const response = await fetch(`${url}/v1/projects`, {
      method: 'POST',
      headers: { authorization: 'Bearer gestor' },
      body: 'x'.repeat(70 * 1024),
    });
    expect(response.status).toBe(413);
  });
});
