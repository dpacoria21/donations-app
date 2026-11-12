# Evidencias

Evidencias sanitizadas de las pruebas contra el stage `academic` (requirements.md §5). Nunca
se guardan tokens, contraseñas, secretos TOTP ni correos reales: el ID de la cuenta se
reemplaza por `<cuenta>` y los usuarios son ficticios.

| Carpeta                                   | Contenido                                                                        | Cómo se generó                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [T10/](T10/iam-report.md)                 | T10 con IAM Policy Simulator, escrituras por rol y IAM Access Analyzer           | `npm run evidence:iam` (backend, solo lectura)                         |
| [observability/](observability/report.md) | Retención, búsqueda de secretos en logs, casos exitosos y rechazados, CloudTrail | `npm run evidence:observability` (backend, solo lectura)               |
| [HU-10/](HU-10/README.md)                 | AUDITOR con MFA consulta la auditoría desde la SPA publicada                     | Procedimiento de alta de docs/pruebas-manuales.md y logs de CloudWatch |
| `performance/`                            | p95 de los GET con 50 proyectos (CA-NF05)                                        | `npm run evidence:perf` (ver docs/pruebas-manuales.md)                 |
| `T08/`, `T13/`, `T14/`                    | Concurrencia, revocación y MFA                                                   | Procedimientos de docs/pruebas-manuales.md                             |

Las pruebas automáticas (Vitest) son la otra mitad de la evidencia: ver la matriz T01–T14 de
[tasks.md](../tasks.md).
