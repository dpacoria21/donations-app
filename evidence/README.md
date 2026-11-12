# Evidencias

Evidencias sanitizadas de las pruebas contra el stage `academic` (requirements.md §5). Nunca
se guardan tokens, contraseñas, secretos TOTP ni correos reales: el ID de la cuenta se
reemplaza por `<cuenta>` y los usuarios son ficticios.

| Carpeta                                   | Contenido                                                                                       | Cómo se generó                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [api/](api/report.md)                     | T02, T04–T09, T11 y T13 contra el API, con dos donantes y login PKCE; cruce con los access logs | `npm run evidence:api` (backend)                                       |
| [T10/](T10/iam-report.md)                 | T10 con IAM Policy Simulator, escrituras por rol y IAM Access Analyzer                          | `npm run evidence:iam` (backend, solo lectura)                         |
| [observability/](observability/report.md) | Retención, búsqueda de secretos en logs, casos exitosos y rechazados, CloudTrail                | `npm run evidence:observability` (backend, solo lectura)               |
| [HU-10/](HU-10/README.md)                 | AUDITOR con MFA consulta la auditoría desde la SPA publicada                                    | Procedimiento de alta de docs/pruebas-manuales.md y logs de CloudWatch |
| [T14/](T14/README.md)                     | Un GESTOR sin TOTP no obtiene tokens                                                            | Usuario `gestor-sin-mfa` y logs del trigger                            |
| `performance/`                            | p95 de los GET con 50 proyectos (CA-NF05)                                                       | `npm run evidence:perf` (ver docs/pruebas-manuales.md)                 |
| `capturas/`                               | 19 capturas de la consola de AWS (CloudFormation, Lambda, API Gateway, Cognito, DynamoDB, IAM, CloudWatch, CloudTrail, CloudFront, S3, Verified Permissions) | Consola, solo lectura, 2026-11-12; sin barra de cuenta e ID enmascarado |

Las pruebas automáticas (Vitest) son la otra mitad de la evidencia: ver la matriz T01–T14 de
[tasks.md](../tasks.md).
