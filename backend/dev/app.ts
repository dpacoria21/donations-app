/**
 * Servidor SOLO para desarrollo local. Imita las rutas de API Gateway HTTP API
 * (payload 2.0) llamando a los mismos handlers Lambda, y sirve páginas HTML
 * simples desde `public/` para comprobar los endpoints. No se despliega: en AWS
 * el frontend va en S3 + CloudFront y la API en API Gateway + Lambda.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Equivalente local de la response headers policy de CloudFront (CA-NF11.2).
const PAGE_HEADERS = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export function createDevServer(): Server {
  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Error interno');
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
    await handleApi(req, res, url, method);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('Método no permitido');
    return;
  }
  await serveStatic(res, url.pathname, method === 'HEAD');
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<void> {
  for (const route of ROUTES) {
    const match = route.method === method ? route.pattern.exec(url.pathname) : null;
    if (match) {
      const result = await route.handler(toEvent(req, url, method, route, match));
      writeResult(res, result);
      return;
    }
  }
  writeResult(res, {
    statusCode: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ code: 'NOT_FOUND', message: 'Ruta no encontrada' }),
  });
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

function writeResult(res: ServerResponse, result: HttpResult): void {
  const headers = Object.fromEntries(
    Object.entries(result.headers ?? {}).map(([name, value]) => [name, String(value)]),
  );
  res.writeHead(result.statusCode ?? 200, headers);
  const body = result.body ?? '';
  res.end(result.isBase64Encoded ? Buffer.from(body, 'base64') : body);
}

async function serveStatic(res: ServerResponse, pathname: string, headOnly: boolean) {
  const file = await readPublicFile(pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...PAGE_HEADERS });
    res.end('No encontrado');
    return;
  }
  res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-cache', ...PAGE_HEADERS });
  res.end(headOnly ? undefined : file.content);
}

async function readPublicFile(pathname: string): Promise<{ type: string; content: Buffer } | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = resolve(PUBLIC_DIR, relative);
  // Impide salir de public/ (por ejemplo, con /..%2fpackage.json).
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  const type = CONTENT_TYPES[extname(filePath)];
  if (!type) return null;
  try {
    return { type, content: await readFile(filePath) };
  } catch {
    return null;
  }
}
