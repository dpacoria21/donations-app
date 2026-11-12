export type Outcome = 'success' | 'client_error' | 'denied' | 'error';

export interface RequestLog {
  requestId: string;
  action: string;
  outcome: Outcome;
  statusCode: number;
  durationMs: number;
  errorCode?: string;
  errorName?: string;
}

export function outcomeFor(statusCode: number): Outcome {
  if (statusCode >= 500) return 'error';
  if (statusCode === 401 || statusCode === 403) return 'denied';
  if (statusCode >= 400) return 'client_error';
  return 'success';
}

/**
 * Una línea JSON por solicitud (CA-NF07.1). Nunca se registran tokens, cabeceras,
 * cuerpos ni datos personales: solo metadatos de la operación.
 */
export function logRequest(entry: RequestLog): void {
  const level = entry.statusCode >= 500 ? 'error' : entry.statusCode >= 400 ? 'warn' : 'info';
  console.log(JSON.stringify({ level, timestamp: new Date().toISOString(), ...entry }));
}
