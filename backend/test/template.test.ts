/**
 * Revisión estática de infra/template.yaml: mínimo privilegio por función (CA-NF03.1,
 * CA-NF03.2, evidencia previa de T10), retención de logs (CA-NF07.1) y coherencia de rutas
 * con el servidor local y docs/api.yaml.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROUTES } from '../dev/app.ts';
import * as donationHandlers from '../src/donations/handlers.ts';
import * as identityHandlers from '../src/identity/handlers.ts';
import * as projectHandlers from '../src/projects/handlers.ts';

interface Resource {
  Type: string;
  Condition?: string;
  DeletionPolicy?: string;
  Properties: Record<string, unknown>;
}

interface Template {
  Conditions?: Record<string, unknown>;
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

  it('cada función solo tiene las acciones de DynamoDB que necesita, por tabla (T10)', () => {
    const PROJECTS = { PROJECTS_TABLE: { Ref: 'ProjectsTable' } };
    const AUDIT = {
      AUDIT_EVENTS_TABLE: { Ref: 'AuditEventsTable' },
      AUDIT_PSEUDONYM_KEY: { Ref: 'AWS::StackId' },
    };
    const expected: Record<
      string,
      { access: Record<string, string[]>; env?: Record<string, unknown> }
    > = {
      ListProjectsFunction: { access: { ProjectsTable: ['dynamodb:Query'] }, env: PROJECTS },
      GetProjectFunction: { access: { ProjectsTable: ['dynamodb:GetItem'] }, env: PROJECTS },
      GetProjectStatsFunction: { access: { ProjectsTable: ['dynamodb:GetItem'] }, env: PROJECTS },
      ListManagedProjectsFunction: {
        access: { ProjectsTable: ['dynamodb:Query'] },
        env: PROJECTS,
      },
      CreateProjectFunction: {
        access: { ProjectsTable: ['dynamodb:PutItem'], AuditEventsTable: ['dynamodb:PutItem'] },
        env: { ...PROJECTS, ...AUDIT },
      },
      UpdateProjectFunction: {
        access: {
          ProjectsTable: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          AuditEventsTable: ['dynamodb:PutItem'],
        },
        env: { ...PROJECTS, ...AUDIT },
      },
      PublishProjectFunction: {
        access: {
          ProjectsTable: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          AuditEventsTable: ['dynamodb:PutItem'],
        },
        env: { ...PROJECTS, ...AUDIT },
      },
      // Trigger de Cognito: no toca DynamoDB ni necesita variables propias.
      PreTokenGenerationFunction: { access: {} },
      GetMyDonationsFunction: {
        access: { DonationsTable: ['dynamodb:Query'] },
        env: { DONATIONS_TABLE: { Ref: 'DonationsTable' } },
      },
      GetDonationFunction: {
        access: { DonationsTable: ['dynamodb:GetItem'] },
        env: { DONATIONS_TABLE: { Ref: 'DonationsTable' } },
      },
      SimulateDonationFunction: {
        access: {
          DonationsTable: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          ProjectsTable: ['dynamodb:UpdateItem'],
          AuditEventsTable: ['dynamodb:PutItem'],
        },
        env: { DONATIONS_TABLE: { Ref: 'DonationsTable' }, ...PROJECTS, ...AUDIT },
      },
      CreateDonationFunction: {
        access: {
          IdempotencyTable: ['dynamodb:GetItem', 'dynamodb:PutItem'],
          DonationsTable: ['dynamodb:GetItem', 'dynamodb:PutItem'],
          ProjectsTable: ['dynamodb:ConditionCheckItem', 'dynamodb:GetItem'],
          AuditEventsTable: ['dynamodb:PutItem'],
        },
        env: {
          DONATIONS_TABLE: { Ref: 'DonationsTable' },
          IDEMPOTENCY_TABLE: { Ref: 'IdempotencyTable' },
          ...PROJECTS,
          ...AUDIT,
        },
      },
    };
    expect(functions.map(([name]) => name).sort()).toEqual(Object.keys(expected).sort());

    for (const [name, { access, env }] of Object.entries(expected)) {
      const granted: Record<string, string[]> = {};
      for (const statement of statementsOf(roleOf(name))) {
        const actions = statement.Action.filter((action) => action.startsWith('dynamodb:'));
        if (actions.length === 0) continue;
        // `!GetAtt Tabla.Arn` o `!Sub ${Tabla.Arn}/index/...`: ambos nombran la tabla.
        const sub = (statement.Resource as { 'Fn::Sub'?: string })['Fn::Sub'];
        const table = sub
          ? (/^\$\{(?<name>\w+)\.Arn\}/.exec(sub)?.groups?.name ?? sub)
          : referencedName(statement.Resource);
        granted[table] = [...(granted[table] ?? []), ...actions].sort();
      }
      expect(granted, name).toEqual(access);
      expect(resource(name).Properties.Environment, name).toEqual(
        env === undefined ? undefined : { Variables: env },
      );
    }
  });

  it('cada Handler apunta a un export real del bundle de su módulo', () => {
    const modules: Record<string, Record<string, unknown>> = {
      '../backend/dist/projects': projectHandlers,
      '../backend/dist/donations': donationHandlers,
      '../backend/dist/identity': identityHandlers,
    };
    for (const [name, fn] of functions) {
      const handlers = modules[String(fn.Properties.CodeUri)];
      expect(handlers, name).toBeDefined();
      const exportName = String(fn.Properties.Handler).replace(/^handlers\./, '');
      expect(typeof handlers?.[exportName], name).toBe('function');
    }
  });
});

describe('infra/template.yaml: HTTP API', () => {
  const api = resource('HttpApi').Properties;

  it('declara las mismas rutas y scopes que el servidor local y docs/api.yaml', () => {
    const declared = functions.flatMap(([, fn]) =>
      Object.values((fn.Properties.Events ?? {}) as Record<string, Resource>).map((event) => {
        expect(event.Type).toBe('HttpApi');
        expect(event.Properties.ApiId).toEqual({ Ref: 'HttpApi' });
        const auth = event.Properties.Auth as
          { Authorizer: string; AuthorizationScopes: string[] } | undefined;
        if (auth) expect(auth.Authorizer).toBe('CognitoJwt');
        const routeKey = `${String(event.Properties.Method)} ${String(event.Properties.Path)}`;
        return `${routeKey} [${(auth?.AuthorizationScopes ?? []).join(' ')}]`;
      }),
    );
    const local = ROUTES.map(
      (route) => `${route.routeKey} [${(route.auth?.scopes ?? []).join(' ')}]`,
    );
    expect(declared.sort()).toEqual(local.sort());
  });

  it('el JWT authorizer valida el emisor del user pool y el client_id de la SPA (CA-NF02.1)', () => {
    const auth = api.Auth as {
      DefaultAuthorizer?: string;
      Authorizers: Record<
        string,
        { IdentitySource: string; JwtConfiguration: { issuer: unknown; audience: unknown[] } }
      >;
    };
    // Sin authorizer por defecto: las rutas públicas no exigen token.
    expect(auth.DefaultAuthorizer).toBeUndefined();
    const jwt = auth.Authorizers.CognitoJwt;
    expect(jwt?.IdentitySource).toBe('$request.header.Authorization');
    expect(jwt?.JwtConfiguration.issuer).toEqual({
      'Fn::Sub': 'https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}',
    });
    expect(jwt?.JwtConfiguration.audience).toEqual([{ Ref: 'WebClient' }]);
  });

  it('usa el stage academic con throttling (design.md §6.2)', () => {
    expect(api.StageName).toEqual({ Ref: 'StageName' });
    expect(template.Parameters.StageName?.AllowedValues).toEqual(['academic', 'prod']);
    expect(api.DefaultRouteSettings).toMatchObject({
      ThrottlingBurstLimit: expect.any(Number) as number,
      ThrottlingRateLimit: expect.any(Number) as number,
    });
  });

  it('admite CORS solo de los orígenes configurados', () => {
    const cors = api.CorsConfiguration as { AllowOrigins: unknown; AllowHeaders: string[] };
    // Los orígenes del parámetro más la SPA publicada; nunca '*'.
    const origins = JSON.stringify(cors.AllowOrigins);
    expect(origins).toContain('{"Ref":"AllowedOrigins"}');
    expect(origins).toContain('https://${SpaDistribution.DomainName}');
    expect(origins).not.toContain('"*"');
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

describe('infra/template.yaml: Cognito (HU-03, HU-04, HU-11)', () => {
  const pool = resource('UserPool').Properties;
  const client = resource('WebClient').Properties;

  it('el user pool solo pide el correo y no permite autorregistro', () => {
    expect(pool.UsernameAttributes).toEqual(['email']);
    expect((pool.Schema as { Name: string }[]).map((attribute) => attribute.Name)).toEqual([
      'email',
    ]);
    expect(pool.AdminCreateUserConfig).toEqual({ AllowAdminCreateUserOnly: true });
  });

  it('el MFA disponible es TOTP, nunca SMS (CA-11.1)', () => {
    expect(pool.MfaConfiguration).toBe('OPTIONAL');
    expect(pool.EnabledMfas).toEqual(['SOFTWARE_TOKEN_MFA']);
  });

  it('existen los grupos DONANTE, GESTOR y AUDITOR', () => {
    const groups = resourcesOfType('AWS::Cognito::UserPoolGroup').map(
      ([, group]) => group.Properties.GroupName,
    );
    expect(groups.sort()).toEqual(['AUDITOR', 'DONANTE', 'GESTOR']);
  });

  it('el resource server `api` define los cuatro scopes del diseño', () => {
    const server = resource('ApiResourceServer').Properties;
    expect(server.Identifier).toBe('api');
    const scopes = (server.Scopes as { ScopeName: string }[]).map((scope) => scope.ScopeName);
    expect(scopes.sort()).toEqual(
      ['audit.read', 'donations.read', 'donations.write', 'projects.write'].sort(),
    );
  });

  it('el app client es público y solo usa Authorization Code + PKCE (CA-03.1)', () => {
    expect(client.GenerateSecret).toBe(false);
    expect(client.AllowedOAuthFlows).toEqual(['code']);
    expect(client.ExplicitAuthFlows).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
    expect(template.Parameters.CallbackUrls?.Default).toContain('/auth/callback');
  });

  it('el access token dura 15 minutos como máximo y la revocación está activa (CA-03.3)', () => {
    expect(client.TokenValidityUnits).toMatchObject({ AccessToken: 'minutes' });
    expect(client.AccessTokenValidity).toBeLessThanOrEqual(15);
    expect(client.EnableTokenRevocation).toBe(true);
  });

  it('managed login v2 tiene estilo asignado al app client', () => {
    expect(resource('UserPoolDomain').Properties.ManagedLoginVersion).toBe(2);
    expect(resource('WebClientBranding').Properties.ClientId).toEqual({ Ref: 'WebClient' });
  });
});

describe('infra/template.yaml: funciones públicas de solo lectura (T10)', () => {
  it('ninguna función de una ruta pública puede escribir en DynamoDB', () => {
    const writes = /^dynamodb:(Put|Update|Delete|BatchWrite|TransactWrite)/;
    for (const [name, fn] of functions) {
      const events = Object.values((fn.Properties.Events ?? {}) as Record<string, Resource>);
      if (events.some((event) => event.Properties.Auth !== undefined)) continue;
      const actions = statementsOf(roleOf(name)).flatMap((statement) => statement.Action);
      expect(
        actions.filter((action) => writes.test(action)),
        name,
      ).toEqual([]);
    }
  });
});

describe('infra/template.yaml: simulación solo en el stage academic (CA-06.1)', () => {
  it('la condición compara el stage con academic', () => {
    expect(template.Conditions?.IsAcademicStage).toEqual({
      'Fn::Equals': [{ Ref: 'StageName' }, 'academic'],
    });
  });

  it('la función, su rol y su log group dependen de esa condición', () => {
    for (const name of [
      'SimulateDonationFunction',
      'SimulateDonationRole',
      'SimulateDonationLogGroup',
    ]) {
      expect(resource(name).Condition, name).toBe('IsAcademicStage');
    }
  });

  it('ninguna otra función depende del stage', () => {
    const conditional = functions.filter(([, fn]) => fn.Condition !== undefined);
    expect(conditional.map(([name]) => name)).toEqual(['SimulateDonationFunction']);
  });
});

describe('infra/template.yaml: MFA obligatorio para GESTOR y AUDITOR (HU-11, D5)', () => {
  const pool = resource('UserPool').Properties;

  it('el user pool ejecuta el trigger antes de emitir tokens', () => {
    expect(pool.LambdaConfig).toEqual({
      PreTokenGenerationConfig: {
        LambdaArn: { 'Fn::GetAtt': 'PreTokenGenerationFunction.Arn' },
        LambdaVersion: 'V1_0',
      },
    });
  });

  it('solo este user pool puede invocar el trigger', () => {
    expect(resource('PreTokenGenerationPermission').Properties).toMatchObject({
      Principal: 'cognito-idp.amazonaws.com',
      SourceArn: { 'Fn::GetAtt': 'UserPool.Arn' },
    });
  });

  it('el rol del trigger solo puede leer usuarios del pool de esta cuenta y Región', () => {
    const cognito = statementsOf('PreTokenGenerationRole').filter((statement) =>
      statement.Action.some((action) => action.startsWith('cognito-idp:')),
    );
    expect(cognito).toHaveLength(1);
    expect(cognito[0]?.Action).toEqual(['cognito-idp:AdminGetUser']);
    // Comodín justificado en la plantilla: evitar la dependencia circular con el pool.
    expect(cognito[0]?.Resource).toEqual({
      'Fn::Sub': 'arn:aws:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/*',
    });
  });

  it('el cliente de alta de MFA no usa OAuth, emite tokens de 5 minutos y no sirve para el API', () => {
    const client = resource('MfaSetupClient').Properties;
    expect(client.AllowedOAuthFlowsUserPoolClient).toBe(false);
    expect(client.GenerateSecret).toBe(false);
    expect(client.AccessTokenValidity).toBe(5);
    const authorizer = (
      resource('HttpApi').Properties.Auth as {
        Authorizers: { CognitoJwt: { JwtConfiguration: { audience: unknown[] } } };
      }
    ).Authorizers.CognitoJwt;
    expect(authorizer.JwtConfiguration.audience).toEqual([{ Ref: 'WebClient' }]);
  });

  it('un cambio de correo exige verificar el nuevo antes de aplicarse', () => {
    expect(pool.UserAttributeUpdateSettings).toEqual({
      AttributesRequireVerificationBeforeUpdate: ['email'],
    });
  });
});

describe('infra/template.yaml: publicación del frontend (CA-NF01.1, CA-NF11.2)', () => {
  const distribution = resource('SpaDistribution').Properties.DistributionConfig as {
    DefaultRootObject: string;
    Origins: { OriginAccessControlId: unknown; S3OriginConfig: { OriginAccessIdentity: string } }[];
    DefaultCacheBehavior: { ViewerProtocolPolicy: string; ResponseHeadersPolicyId: unknown };
  };
  const headers = (
    resource('SpaSecurityHeaders').Properties.ResponseHeadersPolicyConfig as {
      SecurityHeadersConfig: Record<string, Record<string, unknown>>;
    }
  ).SecurityHeadersConfig;

  it('el bucket bloquea todo acceso público y cifra en reposo', () => {
    const bucket = resource('SpaBucket').Properties;
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(JSON.stringify(bucket.BucketEncryption)).toContain('AES256');
  });

  it('solo esta distribución lee el bucket (OAC) y se rechaza HTTP sin TLS', () => {
    const statements = (
      resource('SpaBucketPolicy').Properties.PolicyDocument as {
        Statement: { Effect: string; Principal: unknown; Action: string; Condition: unknown }[];
      }
    ).Statement;
    expect(statements[0]).toMatchObject({
      Effect: 'Allow',
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Action: 's3:GetObject',
    });
    expect(JSON.stringify(statements[0]?.Condition)).toContain('distribution/${SpaDistribution}');
    expect(statements[1]).toMatchObject({
      Effect: 'Deny',
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    });
    expect(distribution.Origins[0]?.OriginAccessControlId).toEqual({
      'Fn::GetAtt': 'SpaOriginAccessControl.Id',
    });
  });

  it('CloudFront redirige a HTTPS y aplica la política de cabeceras', () => {
    expect(distribution.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(distribution.DefaultCacheBehavior.ResponseHeadersPolicyId).toEqual({
      Ref: 'SpaSecurityHeaders',
    });
  });

  it('CSP restrictiva: sin scripts ni estilos en línea, sin frames y sin objetos', () => {
    const csp = JSON.stringify(headers.ContentSecurityPolicy);
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('HSTS de un año, nosniff y Referrer-Policy', () => {
    expect(headers.StrictTransportSecurity).toMatchObject({ AccessControlMaxAgeSec: 31536000 });
    expect(headers.ContentTypeOptions).toEqual({ Override: true });
    expect(headers.ReferrerPolicy).toMatchObject({
      ReferrerPolicy: 'strict-origin-when-cross-origin',
    });
  });

  it('el login vuelve a la SPA publicada', () => {
    const client = resource('WebClient').Properties;
    expect(JSON.stringify(client.CallbackURLs)).toContain(
      'https://${SpaDistribution.DomainName}/auth/callback',
    );
    expect(JSON.stringify(client.LogoutURLs)).toContain('https://${SpaDistribution.DomainName}/');
  });
});
