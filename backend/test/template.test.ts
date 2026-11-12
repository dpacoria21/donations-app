/**
 * Revisión estática de infra/template.yaml: mínimo privilegio por función (CA-NF03.1,
 * CA-NF03.2, evidencia previa de T10), retención de logs (CA-NF07.1) y coherencia de rutas
 * con el servidor local y docs/api.yaml.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROUTES } from '../dev/app.ts';
import * as projectHandlers from '../src/projects/handlers.ts';

interface Resource {
  Type: string;
  DeletionPolicy?: string;
  Properties: Record<string, unknown>;
}

interface Template {
  Parameters: Record<string, { Default?: unknown; AllowedValues?: unknown[] }>;
  Globals: { Function: Record<string, unknown> };
  Resources: Record<string, Resource>;
}

interface Statement {
  Effect: string;
  Action: string[];
  Resource: unknown;
}

interface InlinePolicy {
  PolicyName: string;
  PolicyDocument: { Statement: Statement[] };
}

// Las funciones intrínsecas de CloudFormation se convierten a su forma larga.
const intrinsic = (tag: string, key: string) => ({
  tag: `!${tag}`,
  default: false as const,
  resolve: (value: string) => ({ [key]: value }),
});

const template = parse(
  readFileSync(new URL('../../infra/template.yaml', import.meta.url), 'utf8'),
  {
    customTags: [
      intrinsic('Ref', 'Ref'),
      intrinsic('GetAtt', 'Fn::GetAtt'),
      intrinsic('Sub', 'Fn::Sub'),
    ],
  },
) as Template;

const resourcesOfType = (type: string) =>
  Object.entries(template.Resources).filter(([, resource]) => resource.Type === type);

const functions = resourcesOfType('AWS::Serverless::Function');
const tables = resourcesOfType('AWS::DynamoDB::Table');

function resource(name: string): Resource {
  const found = template.Resources[name];
  if (!found) throw new Error(`No existe el recurso ${name}`);
  return found;
}

/** Nombre del recurso referenciado por `!Ref X` o `!GetAtt X.Attr`. */
function referencedName(value: unknown): string {
  const ref = value as { Ref?: string; 'Fn::GetAtt'?: string };
  const name = ref.Ref ?? ref['Fn::GetAtt']?.split('.')[0];
  if (!name) throw new Error(`No es una referencia: ${JSON.stringify(value)}`);
  return name;
}

function statementsOf(roleName: string): Statement[] {
  const policies = resource(roleName).Properties.Policies as InlinePolicy[];
  return policies.flatMap((policy) => policy.PolicyDocument.Statement);
}

function roleOf(functionName: string): string {
  return referencedName(resource(functionName).Properties.Role);
}

describe('infra/template.yaml: funciones Lambda', () => {
  it('usan Node.js 24 en arm64', () => {
    expect(template.Globals.Function.Runtime).toBe('nodejs24.x');
    expect(template.Globals.Function.Architectures).toEqual(['arm64']);
  });

  it('cada función tiene su propio rol IAM explícito y no usa políticas generadas por SAM', () => {
    const roles = functions.map(([name, fn]) => {
      expect(fn.Properties.Policies, name).toBeUndefined();
      const role = roleOf(name);
      expect(resource(role).Type).toBe('AWS::IAM::Role');
      return role;
    });
    expect(new Set(roles).size).toBe(functions.length);
  });

  it('ningún rol usa comodines en acciones ni en recursos (CA-NF03.2)', () => {
    for (const [name] of functions) {
      for (const statement of statementsOf(roleOf(name))) {
        expect(statement.Effect).toBe('Allow');
        for (const action of statement.Action) expect(action, name).not.toContain('*');
        expect(statement.Resource, name).not.toBe('*');
      }
    }
  });

  it('cada función solo escribe en su propio log group, con retención de 14 días o menos', () => {
    const retention = template.Parameters.LogRetentionDays;
    expect(retention?.Default).toBe(14);
    for (const value of retention?.AllowedValues ?? []) expect(value).toBeLessThanOrEqual(14);

    for (const [name, fn] of functions) {
      const logGroup = referencedName(
        (fn.Properties.LoggingConfig as { LogGroup: unknown }).LogGroup,
      );
      expect(resource(logGroup).Type).toBe('AWS::Logs::LogGroup');
      expect(resource(logGroup).Properties.RetentionInDays).toEqual({ Ref: 'LogRetentionDays' });

      const logStatements = statementsOf(roleOf(name)).filter((s) =>
        s.Action.some((action) => action.startsWith('logs:')),
      );
      expect(logStatements).toHaveLength(1);
      expect(logStatements[0]?.Action.sort()).toEqual([
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ]);
      expect(referencedName(logStatements[0]?.Resource)).toBe(logGroup);
    }
  });

  it('las funciones de proyectos solo leen Projects con una acción concreta (T10)', () => {
    const expected: Record<string, string[]> = {
      ListProjectsFunction: ['dynamodb:Query'],
      GetProjectFunction: ['dynamodb:GetItem'],
      GetProjectStatsFunction: ['dynamodb:GetItem'],
    };
    for (const [name, actions] of Object.entries(expected)) {
      const dynamo = statementsOf(roleOf(name)).filter((s) =>
        s.Action.some((action) => action.startsWith('dynamodb:')),
      );
      expect(
        dynamo.flatMap((s) => s.Action),
        name,
      ).toEqual(actions);
      for (const statement of dynamo) {
        expect(JSON.stringify(statement.Resource), name).toContain('ProjectsTable');
      }
      expect(resource(name).Properties.Environment).toEqual({
        Variables: { PROJECTS_TABLE: { Ref: 'ProjectsTable' } },
      });
    }
  });

  it('cada Handler apunta a un export real del bundle', () => {
    for (const [name, fn] of functions) {
      expect(fn.Properties.CodeUri, name).toBe('../backend/dist/projects');
      const exportName = String(fn.Properties.Handler).replace(/^handlers\./, '');
      expect(typeof projectHandlers[exportName as keyof typeof projectHandlers], name).toBe(
        'function',
      );
    }
  });
});

describe('infra/template.yaml: HTTP API', () => {
  const api = resource('HttpApi').Properties;

  it('declara las mismas rutas que el servidor local y docs/api.yaml', () => {
    const routeKeys = functions.flatMap(([, fn]) =>
      Object.values(fn.Properties.Events as Record<string, Resource>).map((event) => {
        expect(event.Type).toBe('HttpApi');
        expect(event.Properties.ApiId).toEqual({ Ref: 'HttpApi' });
        return `${String(event.Properties.Method)} ${String(event.Properties.Path)}`;
      }),
    );
    expect(routeKeys.sort()).toEqual(ROUTES.map((route) => route.routeKey).sort());
  });

  it('usa el stage academic con throttling (design.md §6.2)', () => {
    expect(api.StageName).toEqual({ Ref: 'StageName' });
    expect(template.Parameters.StageName?.AllowedValues).toEqual(['academic']);
    expect(api.DefaultRouteSettings).toMatchObject({
      ThrottlingBurstLimit: expect.any(Number) as number,
      ThrottlingRateLimit: expect.any(Number) as number,
    });
  });

  it('admite CORS solo de los orígenes configurados', () => {
    const cors = api.CorsConfiguration as { AllowOrigins: unknown; AllowHeaders: string[] };
    expect(cors.AllowOrigins).toEqual({ Ref: 'AllowedOrigins' });
    expect(cors.AllowHeaders).toEqual(['authorization', 'content-type', 'idempotency-key']);
  });

  it('los access logs no registran IP ni cabeceras (CA-NF01.2)', () => {
    const format = (api.AccessLogSettings as { Format: string }).Format;
    expect(() => JSON.parse(format) as unknown).not.toThrow();
    expect(format).toContain('$context.requestId');
    expect(format).not.toMatch(/sourceIp|header|authorization/i);
  });
});

describe('infra/template.yaml: DynamoDB', () => {
  it('las cuatro tablas son on-demand y se borran con la pila', () => {
    expect(tables.map(([name]) => name).sort()).toEqual([
      'AuditEventsTable',
      'DonationsTable',
      'IdempotencyTable',
      'ProjectsTable',
    ]);
    for (const [name, table] of tables) {
      expect(table.Properties.BillingMode, name).toBe('PAY_PER_REQUEST');
      expect(table.DeletionPolicy, name).toBe('Delete');
    }
  });

  it('tiene los índices y el TTL del modelo de datos (design.md §5)', () => {
    const indexNames = (name: string) =>
      (resource(name).Properties.GlobalSecondaryIndexes as { IndexName: string }[]).map(
        (index) => index.IndexName,
      );
    expect(indexNames('ProjectsTable')).toEqual(['status-createdAt']);
    expect(indexNames('DonationsTable')).toEqual(['donorSub-createdAt']);
    expect(resource('IdempotencyTable').Properties.TimeToLiveSpecification).toEqual({
      AttributeName: 'expiresAt',
      Enabled: true,
    });
  });
});
