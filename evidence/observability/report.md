# Evidencia de logs y trazabilidad — stack `donations-academic`

Generado: 2026-11-12T14:59:35.139Z con `npm run evidence:observability` (solo lectura). Periodo: últimos 14 días.

## Retención de los log groups (CA-NF07.1: ≤ 14 días)

| grupo                                                | dias |
| ---------------------------------------------------- | ---- |
| /aws/apigateway/donations-academic-http-api          | 14   |
| /aws/lambda/donations-academic-create-donation       | 14   |
| /aws/lambda/donations-academic-create-project        | 14   |
| /aws/lambda/donations-academic-get-donation          | 14   |
| /aws/lambda/donations-academic-get-my-donations      | 14   |
| /aws/lambda/donations-academic-get-project           | 14   |
| /aws/lambda/donations-academic-get-project-stats     | 14   |
| /aws/lambda/donations-academic-list-managed-projects | 14   |
| /aws/lambda/donations-academic-list-projects         | 14   |
| /aws/lambda/donations-academic-pre-token-generation  | 14   |
| /aws/lambda/donations-academic-publish-project       | 14   |
| /aws/lambda/donations-academic-simulate-donation     | 14   |
| /aws/lambda/donations-academic-update-project        | 14   |

## Búsqueda de secretos y datos personales (CA-NF01.2)

Patrones: JWT (`eyJ…`), `Bearer`, correos electrónicos y la palabra `password`.

**0 coincidencias** en todos los log groups del stack.

## Solicitudes por acción y resultado (logs JSON de Lambda, CA-NF07.1)

| action               | outcome      | statusCode | solicitudes | msPromedio |
| -------------------- | ------------ | ---------- | ----------- | ---------- |
| donations.listMine   | success      | 200        | 7           | 131        |
| donations.listMine   | denied       | 403        | 1           | 1          |
| projects.create      | success      | 201        | 1           | 502        |
| projects.create      | denied       | 403        | 1           | 120        |
| projects.get         | success      | 200        | 17          | 104.2353   |
| projects.get         | client_error | 404        | 3           | 474.6667   |
| projects.list        | success      | 200        | 34          | 221.7059   |
| projects.listManaged | success      | 200        | 13          | 121.5385   |
| projects.publish     | success      | 200        | 1           | 546        |
| projects.stats       | success      | 200        | 11          | 175.9091   |
| projects.update      | success      | 200        | 1           | 103        |
| projects.update      | client_error | 409        | 1           | 615        |

## Respuestas por ruta y estado (access logs de API Gateway)

Los 401 del JWT authorizer no llegan a Lambda: solo aparecen aquí (CA-NF07.2).

| routeKey                               | status | solicitudes |
| -------------------------------------- | ------ | ----------- |
|                                        |        | 1           |
| -                                      | 204    | 19          |
| GET /v1/donations/me                   | 200    | 7           |
| GET /v1/donations/me                   | 401    | 1           |
| GET /v1/donations/me                   | 403    | 1           |
| GET /v1/manage/projects                | 200    | 13          |
| GET /v1/manage/projects                | 401    | 1           |
| GET /v1/projects                       | 200    | 34          |
| GET /v1/projects/{projectId}           | 200    | 17          |
| GET /v1/projects/{projectId}           | 404    | 3           |
| GET /v1/projects/{projectId}/stats     | 200    | 11          |
| PATCH /v1/projects/{projectId}         | 200    | 1           |
| PATCH /v1/projects/{projectId}         | 409    | 1           |
| PATCH /v1/projects/{projectId}/publish | 200    | 1           |
| PATCH /v1/projects/{projectId}/publish | 401    | 1           |
| POST /v1/projects                      | 201    | 1           |
| POST /v1/projects                      | 401    | 1           |
| POST /v1/projects                      | 403    | 1           |

### Ejemplo de caso exitoso y de caso rechazado

Exitoso (2xx):

    {"requestId":"Gut7HjvbCYcEM2w=","time":"12/Nov/2026:13:47:37 +0000","routeKey":"GET /v1/projects","status":"200","latencyMs":"81","integrationError":"-","authorizerError":"-"}

Rechazado (401/403):

    {"requestId":"GuUxCg5XiYcEM1g=","time":"12/Nov/2026:10:55:53 +0000","routeKey":"POST /v1/projects","status":"403","latencyMs":"226","integrationError":"-","authorizerError":"-"}

Rechazado por Lambda (outcome `denied` en el log JSON):

    2026-11-12T10:55:53.602Z	d2d26c96-bace-4b86-bae9-90fdd0ec4cf1	INFO	{"level":"warn","timestamp":"2026-11-12T10:55:53.602Z","requestId":"GuUxCg5XiYcEM1g=","action":"projects.create","outcome":"denied","statusCode":403,"durationMs":120,"errorCode":"FORBIDDEN"}

## Cambios de infraestructura en CloudTrail (CA-NF07.2)

Eventos de CloudFormation sobre el stack (historial de eventos de CloudTrail, 90 días).

| fecha                    | evento           | identidad   |
| ------------------------ | ---------------- | ----------- |
| 2026-11-12T12:12:59.000Z | ExecuteChangeSet | AssumedRole |
| 2026-11-12T12:12:32.000Z | CreateChangeSet  | AssumedRole |
| 2026-11-12T11:49:34.000Z | ExecuteChangeSet | AssumedRole |
| 2026-11-12T11:48:14.000Z | CreateChangeSet  | AssumedRole |
| 2026-11-12T10:42:27.000Z | ExecuteChangeSet | AssumedRole |
| 2026-11-12T10:41:05.000Z | CreateChangeSet  | AssumedRole |
| 2026-11-12T08:55:05.000Z | ExecuteChangeSet | AssumedRole |
| 2026-11-12T08:54:02.000Z | CreateChangeSet  | AssumedRole |
