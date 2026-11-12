/**
 * Servidor SOLO para desarrollo local. Imita API Gateway HTTP API (payload 2.0)
 * invocando los mismos handlers Lambda que se desplegarán, para probar el API
 * desde Postman o desde el frontend. No sirve páginas y no se despliega.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getProject, getProjectStats, listProjects } from '../src/projects/handlers.ts';
import type { HttpResult } from '../src/shared/http.ts';

type LambdaHandler = (event: APIGatewayProxyEventV2) => Promise<HttpResult>;

interface Route {
  method: string;
  routeKey: string;
  pattern: RegExp;
  handler: LambdaHandler;
}

export interface DevServerOptions {
  /** Orígenes del frontend admitidos por CORS (equivale a `CorsConfiguration` de HTTP API). */
  allowedOrigins?: readonly string[];
}

// Mismas rutas que declarará la plantilla SAM (design.md §4).
const ROUTES: readonly Route[] = [
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
];

const CORS_ALLOW_METHODS = 'GET, POST, PATCH, OPTIONS';
const CORS_ALLOW_HEADERS = 'authorization, content-type, idempotency-key';

export function createDevServer(options: DevServerOptions = {}): Server {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  return createServer((req, res) => {
    handle(req, res, allowedOrigins).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Error interno');
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
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
    if (match) {
      const result = await route.handler(toEvent(req, url, method, route, match));
      writeResult(res, result, cors);
      return;
    }
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

function toEvent(
  req: IncomingMessage,
  url: URL,
  method: string,
  route: Route,
  match: RegExpExecArray,
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
