import type { z } from 'zod';
import { badRequest } from './errors.ts';

interface EventWithBody {
  body?: string;
  isBase64Encoded: boolean;
}

/**
 * Lee y valida el cuerpo JSON con un esquema Zod. Cualquier fallo responde 400 indicando solo
 * los campos inválidos, sin repetir los valores recibidos ni detalles internos (CA-NF01.2).
 */
export function parseJsonBody<T>(event: EventWithBody, schema: z.ZodType<T>): T {
  if (!event.body) throw badRequest('El cuerpo de la solicitud es obligatorio');
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw badRequest('El cuerpo no es JSON válido');
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'cuerpo')),
    ];
    throw badRequest(`Datos inválidos: ${fields.join(', ')}`);
  }
  return parsed.data;
}
