# HU-10 — Consulta de auditoría por un AUDITOR con MFA (CA-10.1, CA-11.1)

Fecha: 2026-11-12, stage `academic`.

## Alta del AUDITOR (procedimiento de docs/pruebas-manuales.md)

1. `auditor1@example.com` creado **sin grupo** con `admin-create-user`.
2. TOTP configurado con `npm run setup:mfa`.
3. `admin-get-user` → `UserStatus: CONFIRMED`, `UserMFASettingList: [SOFTWARE_TOKEN_MFA]`.
4. Recién entonces `admin-add-user-to-group` → grupo `AUDITOR`.

## Consulta desde la SPA publicada

Inicio de sesión en CloudFront con usuario, contraseña y código TOTP; pantalla «Auditoría» con
los eventos y con el filtro por tipo. Captura: `auditoria.png` (sin el correo).

Log JSON de la función `list-audit-events` (CloudWatch):

```text
{"level":"info","timestamp":"2026-11-12T17:53:42.491Z","requestId":"GvR91ih3CYcEMIw=","action":"audit.list","outcome":"success","statusCode":200,"durationMs":1037}
{"level":"info","timestamp":"2026-11-12T17:54:05.190Z","requestId":"GvSBohQeiYcEMYQ=","action":"audit.list","outcome":"success","statusCode":200,"durationMs":21}
{"level":"info","timestamp":"2026-11-12T17:54:07.051Z","requestId":"GvSB6g3gCYcEMcQ=","action":"audit.list","outcome":"success","statusCode":200,"durationMs":14}
{"level":"info","timestamp":"2026-11-12T17:54:10.655Z","requestId":"GvSCegeJCYcEMEQ=","action":"audit.list","outcome":"success","statusCode":200,"durationMs":59}
```

La primera consulta (1037 ms) incluye el cold start de la función.

Access logs de API Gateway para la misma ruta:

```text
{"requestId":"GvOs-ixFCYcEPQw=","time":"12/Nov/2026:17:31:24 +0000","routeKey":"GET /v1/audit","status":"401","latencyMs":"0","integrationError":"-","authorizerError":"missing: token not provided"}
{"requestId":"GvSBohQeiYcEMYQ=","time":"12/Nov/2026:17:54:05 +0000","routeKey":"GET /v1/audit","status":"200","latencyMs":"84","integrationError":"-","authorizerError":"-"}
```

Sin token, el JWT authorizer rechaza la solicitud con 401 antes de llegar a Lambda; con el
access token del AUDITOR, 200.
