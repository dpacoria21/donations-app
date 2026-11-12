# Evidencia del API en el stage `academic` (T04–T09, T11, T13)

- Fecha: 2026-11-12T18:50:52.822Z
- Herramienta: `npm run evidence:api` (login con Authorization Code + PKCE en el managed login de
  Cognito; los tokens no se imprimen ni se guardan).
- Usuarios: dos DONANTE distintos de prueba (A y B).
- Proyecto usado: «Huertos escolares en Paucarpata 2026» (`9dd8c801-6189-4675-b809-49cbb888fe80`).
- Donaciones creadas: `062c41ce-df99-45cf-b1ab-e83dd9ef9a3c` (S/ 5.00, pendiente) y `94d3a9c8-f635-407a-bfd1-26b84b0f4858` (S/ 1.00, confirmada en T08).

| Prueba  | Solicitud                                                | Esperado                                      | Obtenido                                              | Resultado |
| ------- | -------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- | --------- |
| T04     | POST /v1/donations (monto 0)                             | 400                                           | 400                                                   | ✅        |
| T04     | POST /v1/donations (monto 100001)                        | 400                                           | 400                                                   | ✅        |
| T04     | POST /v1/donations (monto 15.5)                          | 400                                           | 400                                                   | ✅        |
| T05     | POST /v1/donations (S/ 5.00)                             | 201, PENDIENTE_SIMULACION                     | 201, PENDIENTE_SIMULACION                             | ✅        |
| T06     | Misma Idempotency-Key y mismo cuerpo                     | 201, misma donación, una sola en el historial | 201, misma donación, replayed=true, 1 en el historial | ✅        |
| T07     | Misma Idempotency-Key con otro monto                     | 409                                           | 409                                                   | ✅        |
| T09     | DONANTE B pide la donación de A                          | 404, igual que una inexistente                | 404 (inexistente: 404, mismo cuerpo: sí)              | ✅        |
| T09     | DONANTE A pide su propia donación                        | 200                                           | 200                                                   | ✅        |
| T08     | 10 confirmaciones simultáneas de una donación de S/ 1.00 | 1 × 200, 9 × 409, +100 céntimos               | 1 × 200, 9 × 409, 100 céntimos                        | ✅        |
| T02/T11 | GET /v1/donations/me sin token                           | 401                                           | 401                                                   | ✅        |
| T11     | Access token con la firma alterada                       | 401                                           | 401                                                   | ✅        |
| T11     | ID token como Bearer                                     | 403 (decisión D4: no tiene scopes)            | 403                                                   | ✅        |
| T13     | Revocar el refresh token (/oauth2/revoke)                | 200                                           | 200                                                   | ✅        |
| T13     | Renovar con el refresh token revocado                    | 400 invalid_grant                             | 400 invalid_grant                                     | ✅        |
| T13     | Access token ya emitido, antes de expirar                | 200 (limitación documentada)                  | 200                                                   | ✅        |
| T13     | El mismo access token, después de expirar                | 401                                           | 401                                                   | ✅        |

- T11 con ID token: el JWT authorizer acepta la firma y el `aud` del ID token, pero lo rechaza por no tener los scopes de la ruta y responde **403**, no 401 (decisión D4 de tasks.md).

**Resultado: todas las pruebas pasan.**

## Cruce con los access logs de API Gateway (CloudWatch Logs Insights)

Solicitudes a rutas de donaciones desde las 18:30 UTC del 2026-11-12 (incluye solo esta ejecución):

| Ruta                                     | Estado | Solicitudes |
| ---------------------------------------- | ------ | ----------- |
| GET /v1/donations/me                     | 200    | 2           |
| GET /v1/donations/me                     | 401    | 3           |
| GET /v1/donations/me                     | 403    | 1           |
| GET /v1/donations/{donationId}           | 200    | 1           |
| GET /v1/donations/{donationId}           | 404    | 2           |
| POST /v1/donations                       | 201    | 3           |
| POST /v1/donations                       | 400    | 3           |
| POST /v1/donations                       | 409    | 1           |
| POST /v1/donations/{donationId}/simulate | 200    | 1           |
| POST /v1/donations/{donationId}/simulate | 409    | 9           |

Coincide con el reporte: 3 × 401 (sin token, firma alterada y token expirado de T13), 1 × 403 (ID token,
T11), 3 × 201 (T05, el reintento de T06 y la donación de T08) y 1 × 200 + 9 × 409 en la simulación (T08).
