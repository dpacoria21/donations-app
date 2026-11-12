/**
 * Servidor SOLO para desarrollo local. Imita API Gateway HTTP API (payload 2.0)
 * invocando los mismos handlers Lambda que se desplegarán, para probar el API
 * desde Postman o desde el frontend. No sirve páginas y no se despliega.
 *
 * En las rutas protegidas imita también al JWT authorizer: verifica el token con el
 * user pool real de Cognito y exige al menos uno de los scopes de la ruta. No existe un
 * modo «sin autenticación»: sin Cognito configurado, las rutas protegidas responden 401.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { SCOPES } from '../src/authz/identity.ts';
import {
  createDonation,
  getDonation,
  getMyDonations,
  simulateDonation,
} from '../src/donations/handlers.ts';
import {
  createProject,
  getProject,
  getProjectStats,
  listManagedProjects,
  listProjects,
  publishProject,
  updateProject,
} from '../src/projects/handlers.ts';
import type { HttpResult } from '../src/shared/http.ts';

interface RouteBase {
  method: string;
  routeKey: string;
  pattern: RegExp;
}

interface PublicRoute extends RouteBase {
  auth?: undefined;
  handler: (event: APIGatewayProxyEventV2) => Promise<HttpResult>;
}

interface ProtectedRoute extends RouteBase {
  /** Equivale a `AuthorizationScopes` en SAM: basta con uno de ellos. */
  auth: { scopes: readonly string[] };
  handler: (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<HttpResult>;
}

export type Route = PublicRoute | ProtectedRoute;

/** Verifica firma, emisor, expiración y `client_id`/`aud`; devuelve los claims o lanza. */
export type TokenVerifier = (token: string) => Promise<Record<string, unknown>>;

export interface DevServerOptions {
  /** Orígenes del frontend admitidos por CORS (equivale a `CorsConfiguration` de HTTP API). */
  allowedOrigins?: readonly string[];
  /** Verificador de tokens de Cognito. Sin él, las rutas protegidas responden 401. */
  verifyToken?: TokenVerifier;
}

// Mismas rutas que declara infra/template.yaml y que documenta docs/api.yaml.
export const ROUTES: readonly Route[] = [
  {
    method: 'GET',
    routeKey: 'GET /v1/projects',
    pattern: /^\/v1\/projects$/,
    handler: listProjects,
  },
  {
    method: 'GET',
    routeKey: 'GET /v1/projects/{projectId}',
    pattern: /^\/v1\/projects\/(?<projectId>[^/]+)$/,
    handler: getProject,
  },
  {
    method: 'GET',
    routeKey: 'GET /v1/projects/{projectId}/stats',
    pattern: /^\/v1\/projects\/(?<projectId>[^/]+)\/stats$/,
    handler: getProjectStats,
  },
  {
    method: 'POST',
    routeKey: 'POST /v1/projects',
    pattern: /^\/v1\/projects$/,
    auth: { scopes: [SCOPES.projectsWrite] },
    handler: createProject,
  },
  {
    method: 'PATCH',
    routeKey: 'PATCH /v1/projects/{projectId}',
    pattern: /^\/v1\/projects\/(?<projectId>[^/]+)$/,
    auth: { scopes: [SCOPES.projectsWrite] },
    handler: updateProject,
  },
  {
    method: 'PATCH',
    routeKey: 'PATCH /v1/projects/{projectId}/publish',
    pattern: /^\/v1\/projects\/(?<projectId>[^/]+)\/publish$/,
    auth: { scopes: [SCOPES.projectsWrite] },
    handler: publishProject,
  },
  {
    method: 'GET',
    routeKey: 'GET /v1/manage/projects',
    pattern: /^\/v1\/manage\/projects$/,
    auth: { scopes: [SCOPES.projectsWrite] },
    handler: listManagedProjects,
  },
  {
    method: 'GET',
    routeKey: 'GET /v1/donations/me',
    pattern: /^\/v1\/donations\/me$/,
    auth: { scopes: [SCOPES.donationsRead] },
    handler: getMyDonations,
  },
  // Después de /me: como en HTTP API, la ruta estática gana a la que tiene parámetro.
  {
    method: 'GET',
    routeKey: 'GET /v1/donations/{donationId}',
    pattern: /^\/v1\/donations\/(?<donationId>[^/]+)$/,
    auth: { scopes: [SCOPES.donationsRead] },
    handler: getDonation,
  },
  {
    method: 'POST',
    routeKey: 'POST /v1/donations/{donationId}/simulate',
    pattern: /^\/v1\/donations\/(?<donationId>[^/]+)\/simulate$/,
    auth: { scopes: [SCOPES.donationsWrite] },
    handler: simulateDonation,
  },
  {
    method: 'POST',
    routeKey: 'POST /v1/donations',
    pattern: /^\/v1\/donations$/,
    auth: { scopes: [SCOPES.donationsWrite] },
    handler: createDonation,
  },
];

const CORS_ALLOW_METHODS = 'GET, POST, PATCH, OPTIONS';
const CORS_ALLOW_HEADERS = 'authorization, content-type, idempotency-key';

// Respuestas nativas de API Gateway (no pasan por Lambda ni usan el formato `Error`).
const NATIVE_JSON = { 'content-type': 'application/json' };
const UNAUTHORIZED: HttpResult = {
  statusCode: 401,
  headers: { ...NATIVE_JSON, 'www-authenticate': 'Bearer' },
  body: JSON.stringify({ message: 'Unauthorized' }),
};
const PAYLOAD_TOO_LARGE: HttpResult = {
  statusCode: 413,
  headers: NATIVE_JSON,
  body: JSON.stringify({ message: 'Request Entity Too Large' }),
};
/** Límite del servidor local; HTTP API acepta hasta 10 MB, pero el API no necesita tanto. */
const MAX_BODY_BYTES = 64 * 1024;

/** Lee el cuerpo completo; `null` si supera el límite. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const FORBIDDEN: HttpResult = {
  statusCode: 403,
  headers: NATIVE_JSON,
  body: JSON.stringify({ message: 'Forbidden' }),
};

export function createDevServer(options: DevServerOptions = {}): Server {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  return createServer((req, res) => {
    handle(req, res, allowedOrigins, options.verifyToken).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Error interno');
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
  verifyToken: TokenVerifier | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const origin = req.headers.origin;
  const cors: Record<string, string> =
    origin !== undefined && allowedOrigins.has(origin)
      ? { 'access-control-allow-origin': origin, vary: 'origin' }
      : {};

  // Preflight del navegador: solo se responde con permisos a orígenes admitidos.
  if (method === 'OPTIONS') {
    const allowed = 'access-control-allow-origin' in cors;
    res.writeHead(
      204,
      allowed
        ? {
            ...cors,
            'access-control-allow-methods': CORS_ALLOW_METHODS,
            'access-control-allow-headers': CORS_ALLOW_HEADERS,
            'access-control-max-age': '600',
          }
        : {},
    );
    res.end();
    return;
  }

  for (const route of ROUTES) {
    const match = route.method === method ? route.pattern.exec(url.pathname) : null;
    if (!match) continue;

    const body = await readBody(req);
    if (body === null) {
      writeResult(res, PAYLOAD_TOO_LARGE, cors);
      return;
    }
    const event = toEvent(req, url, method, route, match, body);
    if (!route.auth) {
      writeResult(res, await route.handler(event), cors);
      return;
    }
    const decision = await authorize(req, route.auth.scopes, verifyToken);
    if (!decision.allowed) {
      writeResult(res, decision.response, cors);
      return;
    }
    writeResult(res, await route.handler(withJwt(event, decision.claims)), cors);
    return;
  }

  writeResult(
    res,
    {
      statusCode: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'Ruta no encontrada' }),
    },
    cors,
  );
}

type AuthDecision =
  { allowed: true; claims: Record<string, unknown> } | { allowed: false; response: HttpResult };

/** Lo mismo que hace el JWT authorizer de HTTP API antes de invocar la Lambda. */
async function authorize(
  req: IncomingMessage,
  requiredScopes: readonly string[],
  verifyToken: TokenVerifier | undefined,
): Promise<AuthDecision> {
  const token = /^Bearer (?<token>\S+)$/i.exec(req.headers.authorization ?? '')?.groups?.token;
  if (!token || !verifyToken) return { allowed: false, response: UNAUTHORIZED };

  let claims: Record<string, unknown>;
  try {
    claims = await verifyToken(token);
  } catch {
    return { allowed: false, response: UNAUTHORIZED };
  }

  // Un ID token no tiene claim `scope`: pasa la firma, pero no el scope (decisión D4).
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
  if (!requiredScopes.some((scope) => scopes.includes(scope))) {
    return { allowed: false, response: FORBIDDEN };
  }
  return { allowed: true, claims };
}

/** HTTP API entrega todos los claims como texto; las listas, como `"[A B]"`. */
function toAuthorizerClaims(claims: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(claims).map(([name, value]) => [
      name,
      Array.isArray(value) ? `[${value.map(String).join(' ')}]` : String(value),
    ]),
  );
}

function withJwt(
  event: APIGatewayProxyEventV2,
  claims: Record<string, unknown>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
  return {
    ...event,
    requestContext: {
      ...event.requestContext,
      authorizer: {
        principalId: '',
        integrationLatency: 0,
        jwt: { claims: toAuthorizerClaims(claims), scopes },
      },
    },
  };
}

function toEvent(
  req: IncomingMessage,
  url: URL,
  method: string,
  route: Route,
  match: RegExpExecArray,
  body: string,
): APIGatewayProxyEventV2 {
  const now = Date.now();
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(',') : value;
  }
  const query = Object.fromEntries(url.searchParams);

  return {
    version: '2.0',
    routeKey: route.routeKey,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
    pathParameters: match.groups ? { ...match.groups } : undefined,
    body: body === '' ? undefined : body,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: headers.host ?? 'localhost',
      domainPrefix: 'localhost',
      http: {
        method,
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress ?? '127.0.0.1',
        userAgent: headers['user-agent'] ?? '',
      },
      requestId: randomUUID(),
      routeKey: route.routeKey,
      stage: 'local',
      time: new Date(now).toISOString(),
      timeEpoch: now,
    },
  };
}

function writeResult(res: ServerResponse, result: HttpResult, cors: Record<string, string>): void {
  const headers = Object.fromEntries(
    Object.entries(result.headers ?? {}).map(([name, value]) => [name, String(value)]),
  );
  res.writeHead(result.statusCode ?? 200, { ...headers, ...cors });
  const body = result.body ?? '';
  res.end(result.isBase64Encoded ? Buffer.from(body, 'base64') : body);
}
