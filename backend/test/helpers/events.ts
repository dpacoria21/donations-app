import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/** Evento mínimo de API Gateway HTTP API (payload 2.0) para pruebas de handlers. */
export function httpEvent(
  options: { routeKey?: string; pathParameters?: Record<string, string>; requestId?: string } = {},
): APIGatewayProxyEventV2 {
  const routeKey = options.routeKey ?? 'GET /v1/projects';
  const path = routeKey.split(' ')[1] ?? '/';
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    pathParameters: options.pathParameters,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'test',
      apiId: 'test',
      domainName: 'test.local',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: options.requestId ?? 'req-test-1',
      routeKey,
      stage: 'test',
      time: '11/Nov/2026:10:00:00 +0000',
      timeEpoch: 0,
    },
  };
}

/** Evento con claims tal como los deja el JWT authorizer de HTTP API (todo como texto). */
export function jwtEvent(
  claims: Record<string, string | number | boolean | string[]>,
  options: { routeKey?: string; requestId?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const base = httpEvent(options);
  return {
    ...base,
    requestContext: {
      ...base.requestContext,
      authorizer: { principalId: '', integrationLatency: 0, jwt: { claims, scopes: [] } },
    },
  };
}

/** Claims de un access token de Cognito válido para un donante de prueba. */
export function donorClaims(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    sub: 'b1f0c2d3-0000-4000-8000-000000000001',
    token_use: 'access',
    'cognito:groups': '[DONANTE]',
    scope: 'openid email api/donations.read api/donations.write',
    ...overrides,
  };
}
