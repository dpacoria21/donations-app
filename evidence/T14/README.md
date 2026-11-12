# T14 — Un GESTOR sin segundo factor no obtiene tokens (CA-11.2)

Fecha: 2026-11-12, stage `academic`.

## Preparación

- `gestor-sin-mfa@example.com` creado con `admin-create-user`, contraseña definitiva con
  `admin-set-user-password --permanent` y grupo `GESTOR`, **sin** configurar TOTP.
- `admin-get-user` → `UserStatus: CONFIRMED`, `UserMFASettingList: None`.

## Resultado

Inicio de sesión desde la SPA publicada en CloudFront con usuario y contraseña correctos:
Cognito no emite tokens y vuelve a `/auth/callback` con un error; la SPA muestra «No se pudo
iniciar sesión» y no hay sesión. Captura: `login-rechazado.png`.

Log del trigger _pre token generation_ (CloudWatch, sin datos personales):

```text
2026-11-12T17:56:45.068Z {"level":"warn","action":"identity.preTokenGeneration","outcome":"denied","reason":"MFA_REQUIRED","triggerSource":"TokenGeneration_HostedAuth"}
2026-11-12T17:56:46.203Z ERROR Invoke Error {"errorType":"MfaRequiredError","errorMessage":"MFA_REQUERIDO: las cuentas GESTOR y AUDITOR deben tener una app autenticadora (TOTP)."}
```

`TokenGeneration_HostedAuth` confirma que el rechazo ocurrió en el managed login, antes de emitir
el ID token, el access token y el refresh token.

## Mejora posterior

La primera versión de la pantalla decía «El inicio de sesión se canceló o caducó», que no
explicaba la causa. Ahora, si el error trae `MFA_REQUERIDO`, muestra un mensaje fijo que pide
configurar la app autenticadora (sin repetir el texto de la URL).
