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

/** Evento con claims como los deja el JWT authorizer de HTTP API. */
export function jwtEvent(
  claims: Record<string, string | number | boolean | string[]>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const base = httpEvent();
  return {
    ...base,
    requestContext: {
      ...base.requestContext,
      authorizer: { principalId: '', integrationLatency: 0, jwt: { claims, scopes: [] } },
    },
  };
}
