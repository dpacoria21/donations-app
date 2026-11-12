/**
 * Evidencia de observabilidad y logs (CA-NF01.2, CA-NF07.1, CA-NF07.2). Solo lectura.
 *
 * 1. Retención de cada log group del stack (≤ 14 días).
 * 2. Búsqueda de secretos en los logs con CloudWatch Logs Insights: JWT, `Bearer`, correos y
 *    contraseñas. Lo esperado es 0 coincidencias.
 * 3. Resumen de solicitudes por acción y resultado (Lambda) y por ruta y estado (API Gateway),
 *    con un ejemplo de caso exitoso y uno rechazado (401/403).
 * 4. Cambios de infraestructura registrados por CloudTrail (CloudFormation).
 *
 * Uso: `npm run evidence:observability > ../evidence/observability/report.md`. Opcional:
 * `DAYS=7` (por defecto 14). El ID de la cuenta se reemplaza por `<cuenta>`.
 */
import { CloudFormationClient, paginateListStackResources } from '@aws-sdk/client-cloudformation';
import { CloudTrailClient, LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
  type ResultField,
} from '@aws-sdk/client-cloudwatch-logs';

const stackName = process.env.STACK_NAME ?? 'donations-academic';
const region = process.env.AWS_REGION ?? 'us-east-2';
const days = Number(process.env.DAYS ?? 14);
const cfn = new CloudFormationClient({ region });
const logs = new CloudWatchLogsClient({ region });
const trail = new CloudTrailClient({ region });

const end = Math.floor(Date.now() / 1000);
const start = end - days * 86_400;
const out: string[] = [];
let account = '';
const print = (line = '') => out.push(account ? line.replaceAll(account, '<cuenta>') : line);

const logGroups: string[] = [];
for await (const page of paginateListStackResources({ client: cfn }, { StackName: stackName })) {
  for (const resource of page.StackResourceSummaries ?? []) {
    if (resource.ResourceType === 'AWS::Logs::LogGroup' && resource.PhysicalResourceId) {
      logGroups.push(resource.PhysicalResourceId);
    }
  }
}
const lambdaGroups = logGroups.filter((name) => name.startsWith('/aws/lambda/')).sort();
const apiGroups = logGroups.filter((name) => name.startsWith('/aws/apigateway/'));

async function insights(groups: string[], query: string): Promise<Record<string, string>[]> {
  if (groups.length === 0) return [];
  const { queryId } = await logs.send(
    new StartQueryCommand({
      logGroupNames: groups,
      startTime: start,
      endTime: end,
      queryString: query,
    }),
  );
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const result = await logs.send(new GetQueryResultsCommand({ queryId }));
    if (result.status === 'Complete') {
      return (result.results ?? []).map((row: ResultField[]) =>
        Object.fromEntries(row.map((field) => [field.field ?? '', field.value ?? ''])),
      );
    }
    if (result.status !== 'Running' && result.status !== 'Scheduled') {
      throw new Error(`La consulta terminó con estado ${String(result.status)}`);
    }
  }
}

function table(rows: Record<string, string>[], columns: string[]): void {
  if (rows.length === 0) {
    print('_Sin resultados en el periodo._');
    return;
  }
  print(`| ${columns.join(' | ')} |`);
  print(`| ${columns.map(() => '---').join(' | ')} |`);
  for (const row of rows) print(`| ${columns.map((column) => row[column] ?? '').join(' | ')} |`);
}

print(`# Evidencia de logs y trazabilidad — stack \`${stackName}\``);
print();
print(
  `Generado: ${new Date().toISOString()} con \`npm run evidence:observability\` (solo lectura). ` +
    `Periodo: últimos ${String(days)} días.`,
);
print();

// --------------------------------------------------------------------------- retención
print('## Retención de los log groups (CA-NF07.1: ≤ 14 días)');
print();
const described = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: '/aws/' }));
const retention = new Map(
  (described.logGroups ?? []).map((group) => [group.logGroupName, group.retentionInDays]),
);
account = /:(\d{12}):/.exec(described.logGroups?.[0]?.arn ?? '')?.[1] ?? '';
table(
  logGroups
    .sort()
    .map((name) => ({ grupo: name, dias: String(retention.get(name) ?? 'sin límite') })),
  ['grupo', 'dias'],
);
print();

// --------------------------------------------------------------------------- secretos
print('## Búsqueda de secretos y datos personales (CA-NF01.2)');
print();
print('Patrones: JWT (`eyJ…`), `Bearer`, correos electrónicos y la palabra `password`.');
print();
const leaks = await insights(
  logGroups,
  String.raw`filter @message like /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
    or @message like /(?i)bearer\s+[A-Za-z0-9]/
    or @message like /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
    or @message like /(?i)password/
  | stats count() as coincidencias by @log`,
);
print(
  leaks.length === 0
    ? '**0 coincidencias** en todos los log groups del stack.'
    : 'Coincidencias encontradas (revisar):',
);
if (leaks.length) table(leaks, ['@log', 'coincidencias']);
print();

// --------------------------------------------------------------------------- resumen
print('## Solicitudes por acción y resultado (logs JSON de Lambda, CA-NF07.1)');
print();
table(
  await insights(
    lambdaGroups,
    `filter ispresent(outcome)
    | stats count() as solicitudes, avg(durationMs) as msPromedio by action, outcome, statusCode
    | sort action asc, statusCode asc`,
  ),
  ['action', 'outcome', 'statusCode', 'solicitudes', 'msPromedio'],
);
print();

print('## Respuestas por ruta y estado (access logs de API Gateway)');
print();
print('Los 401 del JWT authorizer no llegan a Lambda: solo aparecen aquí (CA-NF07.2).');
print();
table(
  await insights(
    apiGroups,
    `stats count() as solicitudes by routeKey, status | sort routeKey asc, status asc`,
  ),
  ['routeKey', 'status', 'solicitudes'],
);
print();

print('### Ejemplo de caso exitoso y de caso rechazado');
print();
const sample = async (filter: string) =>
  insights(apiGroups, `${filter} | sort @timestamp desc | limit 1 | display @message`);
print('Exitoso (2xx):');
print();
for (const row of await sample('filter status like /^2/')) print(`    ${row['@message'] ?? ''}`);
print();
print('Rechazado (401/403):');
print();
for (const row of await sample('filter status = "401" or status = "403"')) {
  print(`    ${row['@message'] ?? ''}`);
}
print();
print('Rechazado por Lambda (outcome `denied` en el log JSON):');
print();
for (const row of await insights(
  lambdaGroups,
  `filter outcome = "denied" | sort @timestamp desc | limit 1 | display @message`,
)) {
  print(`    ${row['@message'] ?? ''}`);
}
print();

// --------------------------------------------------------------------------- CloudTrail
print('## Cambios de infraestructura en CloudTrail (CA-NF07.2)');
print();
print('Eventos de CloudFormation sobre el stack (historial de eventos de CloudTrail, 90 días).');
print();
const changes: Record<string, string>[] = [];
let nextToken: string | undefined;
do {
  const page = await trail.send(
    new LookupEventsCommand({
      LookupAttributes: [
        { AttributeKey: 'EventSource', AttributeValue: 'cloudformation.amazonaws.com' },
      ],
      NextToken: nextToken,
    }),
  );
  for (const event of page.Events ?? []) {
    if (!/ChangeSet|Stack/.test(event.EventName ?? '')) continue;
    if (/^(Describe|List|Get)/.test(event.EventName ?? '')) continue;
    if (
      !JSON.stringify(event.Resources ?? []).includes(stackName) &&
      !(event.CloudTrailEvent ?? '').includes(stackName)
    )
      continue;
    changes.push({
      fecha: event.EventTime?.toISOString() ?? '',
      evento: event.EventName ?? '',
      // Solo el tipo de identidad, no el nombre de la persona.
      identidad:
        (JSON.parse(event.CloudTrailEvent ?? '{}') as { userIdentity?: { type?: string } })
          .userIdentity?.type ?? '',
    });
  }
  nextToken = page.NextToken;
} while (nextToken && changes.length < 40);
table(changes.slice(0, 40), ['fecha', 'evento', 'identidad']);

console.log(out.join('\n'));
