import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { AppError } from './errors.ts';
import { logRequest, outcomeFor } from './logger.ts';

export type HttpResult = APIGatewayProxyStructuredResultV2;

/** Lo mínimo que se necesita de un evento de API Gateway HTTP API (payload 2.0). */
interface HttpEventLike {
  requestContext: { requestId: string };
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(statusCode: number, body: unknown): HttpResult {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
}

/**
 * Envuelve un handler Lambda: convierte errores en el formato uniforme
 * `{ code, message, requestId }` sin detalles internos y escribe el log JSON.
 */
export function withHttp<E extends HttpEventLike>(
  action: string,
  handler: (event: E) => Promise<HttpResult>,
): (event: E) => Promise<HttpResult> {
  return async (event) => {
    const started = performance.now();
    const { requestId } = event.requestContext;
    let result: HttpResult;
    let errorCode: string | undefined;
    let errorName: string | undefined;

    try {
      result = await handler(event);
    } catch (error) {
      if (error instanceof AppError) {
        errorCode = error.code;
        result = json(error.statusCode, { code: error.code, message: error.message, requestId });
      } else {
        errorCode = 'INTERNAL';
        errorName = error instanceof Error ? error.name : 'UnknownError';
        result = json(500, { code: 'INTERNAL', message: 'Error interno', requestId });
      }
    }

    const statusCode = result.statusCode ?? 200;
    logRequest({
      requestId,
      action,
      outcome: outcomeFor(statusCode),
      statusCode,
      durationMs: Math.round(performance.now() - started),
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorName === undefined ? {} : { errorName }),
    });
    return result;
  };
}
