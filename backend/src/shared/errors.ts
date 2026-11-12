export type ErrorCode =
  'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

/** Error de negocio que se traduce a una respuesta `{ code, message, requestId }`. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (message = 'Solicitud inválida') =>
  new AppError(400, 'BAD_REQUEST', message);

export const unauthorized = (message = 'Autenticación requerida') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'No tiene permiso para esta operación') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Recurso no encontrado') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message = 'La operación entra en conflicto con el estado actual') =>
  new AppError(409, 'CONFLICT', message);
