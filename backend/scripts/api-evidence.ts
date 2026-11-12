/**
 * Evidencia contra el stage desplegado de T04–T09, T11 y T13 (requirements.md §6).
 *
 * Inicia sesión dos veces con el managed login de Cognito (Authorization Code + PKCE, igual que
 * la SPA): primero el DONANTE «A» y luego otro DONANTE «B». La contraseña y el código se
 * escriben en el navegador; el script solo recibe el código de autorización en
 * http://localhost:5173/auth/callback (URL ya registrada en el app client) y lo canjea por tokens.
 * Los tokens viven en memoria y nunca se imprimen ni se guardan.
 *
 * Uso (con el puerto 5173 libre, es decir, sin `npm run dev` del frontend):
 *
 *   API_URL=<ApiUrl> COGNITO_DOMAIN=<CognitoDomain> COGNITO_CLIENT_ID=<UserPoolClientId> \
 *     npm run evidence:api > ../evidence/api/report.md
 *
 * Crea dos donaciones de prueba (S/ 5 pendiente y S/ 1 confirmada) en el primer proyecto
 * publicado. T13 espera a que caduque el access token (hasta 15 minutos); `SKIP_T13=1` la omite.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
const domain = process.env.COGNITO_DOMAIN?.replace(/\/+$/, '');
const clientId = process.env.COGNITO_CLIENT_ID;
if (!apiUrl || !domain || !clientId) {
  console.error('Faltan API_URL, COGNITO_DOMAIN o COGNITO_CLIENT_ID (salidas de la pila).');
  process.exit(1);
}
const API = apiUrl;
const DOMAIN = domain;
const CLIENT_ID = clientId;
const REDIRECT_URI = 'http://localhost:5173/auth/callback';
const LOGOUT_URI = 'http://localhost:5173/';
const SCOPES = 'openid email api/donations.read api/donations.write';

const log = (message: string) => {
  // El progreso va a stderr; stdout queda solo para el reporte.
  console.error(message);
};

interface Tokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

function claimsOf(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

/**
 * Un inicio de sesión completo. Primero cierra la sesión de Cognito en el navegador (si no, el
 * managed login reutilizaría la del usuario anterior) y después pide el código con PKCE.
 */
async function login(label: string): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomUUID();
  const authorizeUrl =
    `${DOMAIN}/oauth2/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
  const logoutUrl =
    `${DOMAIN}/logout?` +
    new URLSearchParams({ client_id: CLIENT_ID, logout_uri: LOGOUT_URI }).toString();

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost:5173');
      if (url.pathname === '/start') {
        res.writeHead(302, { location: logoutUrl }).end();
      } else if (url.pathname === '/') {
        res.writeHead(302, { location: authorizeUrl }).end();
      } else if (url.pathname === '/auth/callback') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        // Una pestaña anterior (por ejemplo, la del primer login al recargarse) puede volver a
        // pedir su callback con otro `state`: se ignora y se sigue esperando el de este login.
        if (url.searchParams.get('state') !== state) {
          res.end('<p>Esta pestaña es de un inicio de sesión anterior: puedes cerrarla.</p>');
          log('    (se ignoró una respuesta de un inicio de sesión anterior)');
          return;
        }
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        res.end(
          code
            ? '<p>Listo: ya puedes cerrar esta pestaña y volver a la terminal.</p>'
            : '<p>El inicio de sesión no se completó; revisa la terminal.</p>',
        );
        server.close();
        if (code) resolve(code);
        else reject(new Error(`Login fallido: ${error ?? 'sin código'}`));
      } else {
        res.writeHead(404).end();
      }
    });
    server.on('error', reject);
    server.listen(5173, 'localhost', () => {
      log(`\n>>> Inicia sesión como ${label} en el navegador que se abrió.`);
      log('    Si no se abrió, entra a http://localhost:5173/start');
      if (!process.env.NO_BROWSER) openBrowser('http://localhost:5173/start');
    });
  });

  const response = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!response.ok)
    throw new Error(`No se pudo canjear el código: HTTP ${String(response.status)}`);
  const body = (await response.json()) as {
    access_token: string;
    id_token: string;
    refresh_token: string;
  };
  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
  };
}

interface Result {
  id: string;
  request: string;
  expected: string;
  got: string;
  ok: boolean;
}
const results: Result[] = [];
const notes: string[] = [];

function record(id: string, request: string, expected: string, got: string, ok: boolean): void {
  results.push({ id, request, expected, got, ok });
  log(`${ok ? '✔' : '✘'} ${id} ${request}: ${got}`);
}

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; key?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['idempotency-key'] = options.key;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Respuesta sin JSON.
  }
  return { status: response.status, headers: response.headers, json };
}

// ------------------------------------------------------------------------------- inicio
const catalog = await call('GET', '/v1/projects');
const project = (catalog.json.items as { projectId: string; title: string }[] | undefined)?.[0];
if (!project) throw new Error('No hay proyectos publicados.');

const donorA = await login('DONANTE «A» (por ejemplo, donante1)');
const donorB = await login('OTRO DONANTE «B» (por ejemplo, donante2)');
const claimsA = claimsOf(donorA.accessToken);
const claimsB = claimsOf(donorB.accessToken);
for (const [label, claims] of [
  ['A', claimsA],
  ['B', claimsB],
] as const) {
  if (!JSON.stringify(claims['cognito:groups'] ?? []).includes('DONANTE')) {
    throw new Error(`El usuario ${label} no está en el grupo DONANTE.`);
  }
}
if (claimsA.sub === claimsB.sub) throw new Error('A y B deben ser usuarios distintos.');
log('Dos donantes distintos con sesión iniciada.');

// ------------------------------------------------------------------------------- T04
for (const [label, amountCents] of [
  ['monto 0', 0],
  ['monto 100001', 100_001],
  ['monto 15.5', 15.5],
] as const) {
  const r = await call('POST', '/v1/donations', {
    token: donorA.accessToken,
    key: randomUUID(),
    body: { projectId: project.projectId, amountCents },
  });
  record('T04', `POST /v1/donations (${label})`, '400', String(r.status), r.status === 400);
}

// ------------------------------------------------------------------------------- T05 / T06 / T07
const key = randomUUID();
const valid = { projectId: project.projectId, amountCents: 500 };
const created = await call('POST', '/v1/donations', {
  token: donorA.accessToken,
  key,
  body: valid,
});
const donationId = typeof created.json.donationId === 'string' ? created.json.donationId : '';
record(
  'T05',
  'POST /v1/donations (S/ 5.00)',
  '201, PENDIENTE_SIMULACION',
  `${String(created.status)}, ${String(created.json.status)}`,
  created.status === 201 && created.json.status === 'PENDIENTE_SIMULACION',
);

const replay = await call('POST', '/v1/donations', { token: donorA.accessToken, key, body: valid });
const mine = await call('GET', '/v1/donations/me', { token: donorA.accessToken });
const copies = (mine.json.items as { donationId: string }[] | undefined)?.filter(
  (item) => item.donationId === donationId,
).length;
record(
  'T06',
  'Misma Idempotency-Key y mismo cuerpo',
  '201, misma donación, una sola en el historial',
  `${String(replay.status)}, ${replay.json.donationId === donationId ? 'misma' : 'otra'} donación, ` +
    `replayed=${String(replay.headers.get('idempotency-replayed'))}, ${String(copies)} en el historial`,
  replay.status === 201 && replay.json.donationId === donationId && copies === 1,
);

const conflict = await call('POST', '/v1/donations', {
  token: donorA.accessToken,
  key,
  body: { ...valid, amountCents: 9_900 },
});
record(
  'T07',
  'Misma Idempotency-Key con otro monto',
  '409',
  String(conflict.status),
  conflict.status === 409,
);

// ------------------------------------------------------------------------------- T09
const foreign = await call('GET', `/v1/donations/${donationId}`, { token: donorB.accessToken });
const missing = await call('GET', `/v1/donations/${randomUUID()}`, { token: donorB.accessToken });
const sameBody =
  foreign.json.code === missing.json.code && foreign.json.message === missing.json.message;
record(
  'T09',
  'DONANTE B pide la donación de A',
  '404, igual que una inexistente',
  `${String(foreign.status)} (inexistente: ${String(missing.status)}, mismo cuerpo: ${sameBody ? 'sí' : 'no'})`,
  foreign.status === 404 && missing.status === 404 && sameBody,
);
const own = await call('GET', `/v1/donations/${donationId}`, { token: donorA.accessToken });
record('T09', 'DONANTE A pide su propia donación', '200', String(own.status), own.status === 200);

// ------------------------------------------------------------------------------- T08
const t08 = await call('POST', '/v1/donations', {
  token: donorA.accessToken,
  key: randomUUID(),
  body: { projectId: project.projectId, amountCents: 100 },
});
const t08Id = typeof t08.json.donationId === 'string' ? t08.json.donationId : '';
const confirmed = async () =>
  Number((await call('GET', `/v1/projects/${project.projectId}/stats`)).json.confirmedAmountCents);
const before = await confirmed();
const statuses = await Promise.all(
  Array.from(
    { length: 10 },
    async () =>
      (
        await call('POST', `/v1/donations/${t08Id}/simulate`, {
          token: donorA.accessToken,
          body: { outcome: 'CONFIRMADA_SIMULADA' },
        })
      ).status,
  ),
);
const after = await confirmed();
const count = (code: number) => statuses.filter((status) => status === code).length;
record(
  'T08',
  '10 confirmaciones simultáneas de una donación de S/ 1.00',
  '1 × 200, 9 × 409, +100 céntimos',
  `${String(count(200))} × 200, ${String(count(409))} × 409, ${String(after - before)} céntimos`,
  count(200) === 1 && count(409) === 9 && after - before === 100,
);

// ------------------------------------------------------------------------------- T11
const noToken = await call('GET', '/v1/donations/me');
record(
  'T02/T11',
  'GET /v1/donations/me sin token',
  '401',
  String(noToken.status),
  noToken.status === 401,
);
const [header = '', payload = '', signature = ''] = donorA.accessToken.split('.');
const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
const tampered = await call('GET', '/v1/donations/me', {
  token: `${header}.${payload}.${flipped}`,
});
record(
  'T11',
  'Access token con la firma alterada',
  '401',
  String(tampered.status),
  tampered.status === 401,
);
const idToken = await call('GET', '/v1/donations/me', { token: donorA.idToken });
record(
  'T11',
  'ID token como Bearer',
  '403 (decisión D4: no tiene scopes)',
  String(idToken.status),
  idToken.status === 403,
);
notes.push(
  'T11 con ID token: el JWT authorizer acepta la firma y el `aud` del ID token, pero lo rechaza por ' +
    'no tener los scopes de la ruta y responde **403**, no 401 (decisión D4 de tasks.md).',
);

// ------------------------------------------------------------------------------- T13
if (process.env.SKIP_T13 === '1') {
  notes.push('T13 omitida (`SKIP_T13=1`).');
} else {
  const revoke = await fetch(`${DOMAIN}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: donorA.refreshToken, client_id: CLIENT_ID }),
  });
  record(
    'T13',
    'Revocar el refresh token (/oauth2/revoke)',
    '200',
    String(revoke.status),
    revoke.status === 200,
  );
  const refresh = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: donorA.refreshToken,
    }),
  });
  const refreshError = ((await refresh.json()) as { error?: string }).error ?? '';
  record(
    'T13',
    'Renovar con el refresh token revocado',
    '400 invalid_grant',
    `${String(refresh.status)} ${refreshError}`,
    refresh.status === 400 && refreshError === 'invalid_grant',
  );
  const stillValid = await call('GET', '/v1/donations/me', { token: donorA.accessToken });
  record(
    'T13',
    'Access token ya emitido, antes de expirar',
    '200 (limitación documentada)',
    String(stillValid.status),
    stillValid.status === 200,
  );
  const exp = Number(claimsA.exp) * 1000;
  for (;;) {
    const left = exp + 5_000 - Date.now();
    if (left <= 0) break;
    log(`    T13: esperando a que expire el access token (${String(Math.ceil(left / 1000))} s)…`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 60_000)));
  }
  const expired = await call('GET', '/v1/donations/me', { token: donorA.accessToken });
  record(
    'T13',
    'El mismo access token, después de expirar',
    '401',
    String(expired.status),
    expired.status === 401,
  );
}

// ------------------------------------------------------------------------------- reporte
const lines = [
  '# Evidencia del API en el stage `academic` (T04–T09, T11, T13)',
  '',
  `- Fecha: ${new Date().toISOString()}`,
  '- Herramienta: `npm run evidence:api` (login con Authorization Code + PKCE en el managed login de',
  '  Cognito; los tokens no se imprimen ni se guardan).',
  '- Usuarios: dos DONANTE distintos de prueba (A y B).',
  `- Proyecto usado: «${project.title}» (\`${project.projectId}\`).`,
  `- Donaciones creadas: \`${donationId}\` (S/ 5.00, pendiente) y \`${t08Id}\` (S/ 1.00, confirmada en T08).`,
  '',
  '| Prueba | Solicitud | Esperado | Obtenido | Resultado |',
  '| --- | --- | --- | --- | --- |',
  ...results.map(
    (r) => `| ${r.id} | ${r.request} | ${r.expected} | ${r.got} | ${r.ok ? '✅' : '❌'} |`,
  ),
  '',
  ...notes.map((note) => `- ${note}`),
  '',
  results.every((r) => r.ok)
    ? '**Resultado: todas las pruebas pasan.**'
    : '**Resultado: hay pruebas que fallan.**',
];
console.log(lines.join('\n'));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
