/** Evento de auditoría tal como lo devuelve `GET /v1/audit` (`AuditEvent` en docs/api.yaml). */
export interface AuditEvent {
  eventType: AuditEventType;
  eventId: string;
  timestamp: string;
  requestId: string;
  actorRef: string;
  actorRole: string | null;
  action: string;
  resourceRef: string;
  outcome: 'SUCCESS' | 'DENIED' | 'REJECTED';
  changedFields?: string[];
}

export interface AuditEventList {
  items: AuditEvent[];
  nextCursor?: string;
}

export const AUDIT_EVENT_TYPES = [
  'PROJECT_CREATE',
  'PROJECT_UPDATE',
  'PROJECT_PUBLISH',
  'DONATION_CREATE',
  'DONATION_SIMULATE',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  PROJECT_CREATE: 'Creación de proyecto',
  PROJECT_UPDATE: 'Edición de proyecto',
  PROJECT_PUBLISH: 'Publicación de proyecto',
  DONATION_CREATE: 'Intención de donación',
  DONATION_SIMULATE: 'Simulación de donación',
};

export const OUTCOME_LABELS: Record<AuditEvent['outcome'], string> = {
  SUCCESS: 'Éxito',
  DENIED: 'Denegado',
  REJECTED: 'Rechazado',
};

export interface AuditFilters {
  eventType: AuditEventType | '';
  from: string;
  to: string;
}

/** Parámetros de la consulta: solo los filtros con valor. */
export function auditSearchParams(filters: AuditFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.eventType) params.set('eventType', filters.eventType);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', '50');
  if (cursor) params.set('cursor', cursor);
  return params;
}
