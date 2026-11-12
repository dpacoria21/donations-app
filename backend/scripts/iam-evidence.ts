/**
 * Evidencia de mínimo privilegio (T10, CA-NF03.1, CA-NF03.2). Solo lectura: no cambia nada en
 * la cuenta.
 *
 * 1. Lee los roles y las tablas del stack con CloudFormation.
 * 2. T10: con IAM Policy Simulator (`SimulateCustomPolicy`, con las políticas reales de cada
 *    rol) comprueba que el rol de la función de listado no puede escribir en ninguna tabla, y
 *    muestra qué escrituras permite cada rol. No se usa `SimulatePrincipalPolicy` porque en
 *    esta cuenta también evalúa las SCP de la organización de AWS, que el simulador no puede
 *    leer, y responde `explicitDeny` incluso a lo que la función sí hace.
 * 3. Revisa cada política en línea con IAM Access Analyzer (`ValidatePolicy`) y busca
 *    comodines (`*`) en acciones y recursos.
 *
 * Uso (con `aws login` hecho): `npm run evidence:iam > ../evidence/T10/iam-report.md`.
 * El ID de la cuenta se reemplaza por `<cuenta>` en el reporte.
 */
import { AccessAnalyzerClient, ValidatePolicyCommand } from '@aws-sdk/client-accessanalyzer';
import { CloudFormationClient, paginateListStackResources } from '@aws-sdk/client-cloudformation';
import {
  GetRoleCommand,
  GetRolePolicyCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  SimulateCustomPolicyCommand,
} from '@aws-sdk/client-iam';

const stackName = process.env.STACK_NAME ?? 'donations-academic';
const region = process.env.AWS_REGION ?? 'us-east-2';
const cfn = new CloudFormationClient({ region });
const iam = new IAMClient({ region });
const analyzer = new AccessAnalyzerClient({ region });

/** Escrituras de DynamoDB que se prueban contra cada tabla. */
const WRITE_ACTIONS = [
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:BatchWriteItem',
];

interface PolicyDoc {
  Statement: { Effect: string; Action: string | string[]; Resource: string | string[] }[];
}

const roles = new Map<string, string>(); // lógico → nombre físico
const tables = new Map<string, string>(); // lógico → nombre físico
for await (const page of paginateListStackResources({ client: cfn }, { StackName: stackName })) {
  for (const resource of page.StackResourceSummaries ?? []) {
    if (!resource.LogicalResourceId || !resource.PhysicalResourceId) continue;
    if (resource.ResourceType === 'AWS::IAM::Role') {
      roles.set(resource.LogicalResourceId, resource.PhysicalResourceId);
    }
    if (resource.ResourceType === 'AWS::DynamoDB::Table') {
      tables.set(resource.LogicalResourceId, resource.PhysicalResourceId);
    }
  }
}

const roleArns = new Map<string, string>();
for (const [logical, name] of roles) {
  const { Role } = await iam.send(new GetRoleCommand({ RoleName: name }));
  if (Role?.Arn) roleArns.set(logical, Role.Arn);
}
/** Políticas en línea de cada rol (los roles no tienen políticas administradas). */
const rolePolicies = new Map<string, { name: string; document: string }[]>();
let managedCount = 0;
for (const [logical, name] of roles) {
  const attached = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: name }));
  managedCount += attached.AttachedPolicies?.length ?? 0;
  const { PolicyNames } = await iam.send(new ListRolePoliciesCommand({ RoleName: name }));
  const documents: { name: string; document: string }[] = [];
  for (const policyName of PolicyNames ?? []) {
    const { PolicyDocument } = await iam.send(
      new GetRolePolicyCommand({ RoleName: name, PolicyName: policyName }),
    );
    documents.push({ name: policyName, document: decodeURIComponent(PolicyDocument ?? '{}') });
  }
  rolePolicies.set(logical, documents);
}

async function simulate(logical: string, actions: string[], resource: string) {
  const { EvaluationResults } = await iam.send(
    new SimulateCustomPolicyCommand({
      PolicyInputList: (rolePolicies.get(logical) ?? []).map((policy) => policy.document),
      ActionNames: actions,
      ResourceArns: [resource],
    }),
  );
  return EvaluationResults ?? [];
}

const account = /arn:aws:iam::(\d{12}):/.exec([...roleArns.values()][0] ?? '')?.[1] ?? '';
const tableArn = (name: string) => `arn:aws:dynamodb:${region}:${account}:table/${name}`;
const out: string[] = [];
const print = (line = '') => out.push(line.replaceAll(account, '<cuenta>'));

print(`# Evidencia de mínimo privilegio — stack \`${stackName}\``);
print();
print(`Generado: ${new Date().toISOString()} con \`npm run evidence:iam\` (solo lectura).`);
print();

// --------------------------------------------------------------------------- T10
print('## T10: la función de listado no puede escribir (IAM Policy Simulator)');
print();
if (!rolePolicies.has('ListProjectsRole')) throw new Error('No se encontró ListProjectsRole');
print('| Acción | Recurso | Decisión |');
print('| --- | --- | --- |');
const listChecks: [string, string][] = [
  ['dynamodb:Query', `${tableArn(tables.get('ProjectsTable') ?? '')}/index/status-createdAt`],
  ...WRITE_ACTIONS.map((action): [string, string] => [
    action,
    tableArn(tables.get('ProjectsTable') ?? ''),
  ]),
  ['dynamodb:Scan', tableArn(tables.get('ProjectsTable') ?? '')],
  ['dynamodb:GetItem', tableArn(tables.get('DonationsTable') ?? '')],
];
for (const [action, resource] of listChecks) {
  const [result] = await simulate('ListProjectsRole', [action], resource);
  const decision = result?.EvalDecision ?? '?';
  print(`| \`${action}\` | \`${resource.split(':').pop() ?? ''}\` | ${decision} |`);
}
print();

// --------------------------------------------------------------------------- matriz
print('## Escrituras permitidas por rol y tabla');
print();
print('Cada celda indica las acciones de escritura que el simulador permite (— = ninguna).');
print();
const tableNames = [...tables.keys()].sort();
print(`| Rol | ${tableNames.join(' | ')} |`);
print(`| --- | ${tableNames.map(() => '---').join(' | ')} |`);
for (const logical of [...roles.keys()].sort()) {
  const cells: string[] = [];
  for (const table of tableNames) {
    const results = await simulate(logical, WRITE_ACTIONS, tableArn(tables.get(table) ?? ''));
    const allowed = results
      .filter((result) => result.EvalDecision === 'allowed')
      .map((result) => result.EvalActionName?.replace('dynamodb:', ''));
    cells.push(allowed.length ? allowed.join(', ') : '—');
  }
  print(`| ${logical} | ${cells.join(' | ')} |`);
}
print();

// --------------------------------------------------------------------------- Access Analyzer
print('## IAM Access Analyzer (`ValidatePolicy`) y comodines');
print();
print('| Rol | Política | Hallazgos de Access Analyzer | Comodines |');
print('| --- | --- | --- | --- |');
for (const logical of [...roles.keys()].sort()) {
  for (const { name: policyName, document } of rolePolicies.get(logical) ?? []) {
    const { findings } = await analyzer.send(
      new ValidatePolicyCommand({ policyDocument: document, policyType: 'IDENTITY_POLICY' }),
    );
    const summary = findings?.length
      ? findings
          .map((finding) => `${String(finding.findingType)}: ${String(finding.issueCode)}`)
          .join('; ')
      : 'ninguno';
    const parsed = JSON.parse(document) as PolicyDoc;
    const wildcards = parsed.Statement.flatMap((statement) =>
      [statement.Action, statement.Resource].flat().filter((value) => value.includes('*')),
    );
    print(
      `| ${logical} | ${policyName} | ${summary} | ${wildcards.length ? wildcards.map((w) => `\`${w}\``).join(', ') : '—'} |`,
    );
  }
}
print();
print(`Políticas administradas adjuntas a los roles: ${String(managedCount)}.`);

console.log(out.join('\n'));
