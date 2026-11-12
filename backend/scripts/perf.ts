/**
 * Medición de rendimiento de las rutas GET públicas (CA-NF05.1, CA-NF05.2).
 *
 * Método:
 * - Calentamiento: WARMUP solicitudes por ruta que no se cuentan (excluye el cold start).
 * - Medición: REQUESTS solicitudes secuenciales por ruta, tiempo total de cada `fetch` (DNS,
 *   TLS reutilizado, API Gateway, Lambda, DynamoDB y descarga del cuerpo) con
 *   `performance.now()`.
 * - Se informa p50, p95, p99 y máximo; el criterio es p95 ≤ 1500 ms.
 *
 * Uso: `API_URL=https://…/academic npm run evidence:perf > ../evidence/performance/report.md`
 * Opcional: WARMUP (5), REQUESTS (100), MIN_PROJECTS (50).
 */
const apiUrl = process.env.API_URL?.replace(/\/$/, '');
if (!apiUrl) {
  console.error('Define API_URL con la salida ApiUrl de la pila.');
  process.exit(1);
}
const warmup = Number(process.env.WARMUP ?? 5);
const requests = Number(process.env.REQUESTS ?? 100);
const minProjects = Number(process.env.MIN_PROJECTS ?? 50);
const THRESHOLD_MS = 1500;

async function timed(url: string): Promise<{ ms: number; status: number; body: unknown }> {
  const started = performance.now();
  const response = await fetch(url);
  const body: unknown = await response.json();
  return { ms: performance.now() - started, status: response.status, body };
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

const catalog = await timed(`${apiUrl}/v1/projects`);
const items = (catalog.body as { items?: { projectId: string }[] }).items ?? [];
const sampleId = items[0]?.projectId;
if (!sampleId) throw new Error('El catálogo está vacío');

const routes = [
  { name: 'GET /v1/projects', url: `${apiUrl}/v1/projects` },
  { name: 'GET /v1/projects/{projectId}', url: `${apiUrl}/v1/projects/${sampleId}` },
  { name: 'GET /v1/projects/{projectId}/stats', url: `${apiUrl}/v1/projects/${sampleId}/stats` },
];

const lines: string[] = [];
const print = (line = '') => lines.push(line);
print('# Rendimiento de las rutas GET (CA-NF05.1, CA-NF05.2)');
print();
print(`- Fecha: ${new Date().toISOString()}`);
print(`- Herramienta: \`npm run evidence:perf\` (Node.js ${process.version}, \`fetch\` nativo).`);
print(
  `- API: stage \`${apiUrl.split('/').pop() ?? ''}\` en ${new URL(apiUrl).hostname.split('.')[2] ?? ''}.`,
);
print(
  `- Proyectos publicados en el catálogo: **${String(items.length)}** (mínimo exigido: ${String(minProjects)}).`,
);
print(
  `- Método: ${String(warmup)} solicitudes de calentamiento por ruta (no se cuentan, excluyen el ` +
    `cold start) y ${String(requests)} solicitudes secuenciales medidas por ruta. Se mide el ` +
    'tiempo total de cada solicitud vista por el cliente, incluida la descarga del cuerpo.',
);
print('- Condiciones: un solo cliente, sin concurrencia, conexión HTTPS reutilizada (keep-alive).');
print();
print('| Ruta | n | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) | Errores | ¿p95 ≤ 1500 ms? |');
print('| --- | --- | --- | --- | --- | --- | --- | --- |');

let allPass = items.length >= minProjects;
for (const route of routes) {
  for (let i = 0; i < warmup; i++) await timed(route.url);
  const samples: number[] = [];
  let errors = 0;
  for (let i = 0; i < requests; i++) {
    const result = await timed(route.url);
    if (result.status !== 200) errors += 1;
    samples.push(result.ms);
  }
  samples.sort((a, b) => a - b);
  const p95 = percentile(samples, 95);
  const pass = p95 <= THRESHOLD_MS && errors === 0;
  allPass &&= pass;
  const fmt = (value: number) => value.toFixed(0);
  print(
    `| \`${route.name}\` | ${String(samples.length)} | ${fmt(percentile(samples, 50))} | ` +
      `${fmt(p95)} | ${fmt(percentile(samples, 99))} | ${fmt(samples.at(-1) ?? Number.NaN)} | ` +
      `${String(errors)} | ${pass ? 'Sí' : 'No'} |`,
  );
}
print();
print(
  allPass
    ? '**Resultado: cumple CA-NF05.1.**'
    : `**Resultado: no cumple** (revisar la tabla o el número de proyectos, mínimo ${String(minProjects)}).`,
);

console.log(lines.join('\n'));
process.exitCode = allPass ? 0 : 1;
