# Pruebas manuales contra el stage desplegado

Algunas pruebas dependen de Cognito y del tiempo real (expiración de tokens), así que no se
pueden automatizar en el CI. Aquí está el procedimiento de cada una. Las capturas, sin tokens
ni contraseñas visibles, se guardan en `evidence/` (design.md §8).

Valores de la pila: `aws cloudformation describe-stacks --stack-name donations-academic
--query "Stacks[0].Outputs"`.

## Alta de un GESTOR o AUDITOR con MFA (HU-11, decisión D5)

Cognito solo permite MFA obligatorio para todo el pool. Para exigirlo solo a GESTOR y AUDITOR,
el trigger _pre token generation_ rechaza la emisión de tokens a un usuario de esos grupos que
no tenga TOTP activo. Por eso el TOTP se configura **antes** de asignar el grupo:

1. El administrador crea la cuenta **sin grupo**:

   ```bash
   aws cognito-idp admin-create-user --user-pool-id POOL_ID --username gestor2@example.com --user-attributes Name=email,Value=gestor2@example.com Name=email_verified,Value=true --temporary-password "CambiarEsta123" --message-action SUPPRESS --region us-east-2 --profile donations-dev
   ```

2. La persona configura su app autenticadora. En `backend/.env`, completar
   `COGNITO_MFA_SETUP_CLIENT_ID` con la salida `MfaSetupClientId` y ejecutar:

   ```bash
   npm run setup:mfa
   ```

3. El administrador comprueba que el TOTP está activo; debe aparecer `SOFTWARE_TOKEN_MFA`:

   ```bash
   aws cognito-idp admin-get-user --user-pool-id POOL_ID --username gestor2@example.com --query UserMFASettingList --region us-east-2 --profile donations-dev
   ```

4. Recién entonces le asigna el grupo:

   ```bash
   aws cognito-idp admin-add-user-to-group --user-pool-id POOL_ID --username gestor2@example.com --group-name GESTOR --region us-east-2 --profile donations-dev
   ```

**Cuentas que ya tienen el grupo y no tienen TOTP** (por ejemplo, un `gestor1` creado en la
fase 3): desde este despliegue ya no pueden iniciar sesión. Quitar el grupo con
`admin-remove-user-from-group`, hacer los pasos 2 a 4 y volver a asignarlo.

## T14 — Un GESTOR sin segundo factor no obtiene tokens (CA-11.2)

1. Crear `gestor-sin-mfa@example.com` y asignarle **directamente** el grupo GESTOR (sin el
   paso 2 anterior).
2. En la SPA, «Iniciar sesión» con esa cuenta.
3. **Esperado:** después de la contraseña, Cognito muestra un error y no vuelve a la SPA con
   tokens. En CloudWatch, el log group `/aws/lambda/donations-academic-pre-token-generation`
   registra `"outcome":"denied","reason":"MFA_REQUIRED"`.
4. Repetir con un GESTOR dado de alta con MFA: Cognito pide el código de 6 dígitos y, sin él,
   tampoco hay tokens; con él, se entra normalmente.
5. Guardar las capturas en `evidence/T14/`.

Como el trigger también corre al renovar tokens, si una persona desactivara su MFA, la
siguiente renovación fallaría y la sesión terminaría.

## T13 — Token revocado: aceptado hasta expirar (CA-03.3, CA-03.4)

El JWT authorizer valida los tokens localmente (firma y expiración) y no consulta a Cognito si
fueron revocados. La revocación invalida el **refresh token**: ya no se pueden obtener access
tokens nuevos, pero el que ya se emitió sigue valiendo hasta su expiración (15 minutos).

1. En Postman, obtener un token con «Get New Access Token» (carpeta «Donaciones (protegido)»).
   Anotar la hora: `exp` del access token = hora de emisión + 15 min. Copiar el refresh token.
2. Llamar a «HU-07 — Historial propio» → **200**.
3. Revocar el refresh token (el `client_id` es la salida `UserPoolClientId`):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://DOMINIO.auth.us-east-2.amazoncognito.com/oauth2/revoke -H "Content-Type: application/x-www-form-urlencoded" -d "token=REFRESH_TOKEN&client_id=CLIENT_ID"
   ```

   Esperado: **200**. Es lo mismo que hace la SPA al cerrar sesión.

4. Intentar renovar con el refresh token revocado:

   ```bash
   curl -s -X POST https://DOMINIO.auth.us-east-2.amazoncognito.com/oauth2/token -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=refresh_token&client_id=CLIENT_ID&refresh_token=REFRESH_TOKEN"
   ```

   Esperado: `{"error":"invalid_grant"}`. **La sesión ya no se puede renovar.**

5. Antes de que pasen los 15 minutos, repetir «HU-07 — Historial propio» con el mismo access
   token → **200** (limitación documentada, design.md §6.3).
6. Después de la expiración, repetirlo → **401**.
7. Guardar las respuestas (sin el token completo) en `evidence/T13/`.

## T08 — 10 confirmaciones concurrentes (CA-06.2, CA-NF04.1)

Crear una donación nueva (queda `PENDIENTE_SIMULACION`), copiar su `donationId` y el access
token del DONANTE, y desde `backend/`:

```bash
API_URL=<ApiUrl> ACCESS_TOKEN=<token> DONATION_ID=<id> npm run evidence:t08
```

Esperado: `1 × 200, 9 × 409` y el acumulado del proyecto sube exactamente el monto de la
donación. Guardar la salida en `evidence/T08/`.

## Rendimiento con 50 proyectos (CA-NF05.1, CA-NF05.2)

Escribe en la tabla `Projects` compartida: hacerlo cuando nadie esté haciendo la demo. Desde
`backend/`, con `aws login` hecho:

```bash
PROJECTS_TABLE=<ProjectsTableName> AWS_PROFILE=donations-dev npm run seed:projects -- --load
```

```bash
API_URL=<ApiUrl> npm run evidence:perf > ../evidence/performance/report.md
```

```bash
PROJECTS_TABLE=<ProjectsTableName> AWS_PROFILE=donations-dev npm run seed:projects -- --remove-load
```

El primer comando crea 50 proyectos PUBLICADO «Proyecto de carga NN» con IDs `10ad0000-…`; el
último borra solo esos. El reporte indica la fecha, la herramienta, el método (5 solicitudes de
calentamiento sin contar y 100 medidas por ruta) y las condiciones. Se mide desde el equipo de
quien lo ejecuta (Perú → us-east-2), una condición más exigente que «un cliente cercano a la
región»; para medir desde la región, ejecutarlo en CloudShell.

## Evidencia de IAM, logs y CloudTrail (fase 6)

Solo lectura. Desde `backend/`, con `aws login` hecho:

```bash
AWS_PROFILE=donations-dev npm run evidence:iam > ../evidence/T10/iam-report.md
```

```bash
AWS_PROFILE=donations-dev npm run evidence:observability > ../evidence/observability/report.md
```

Revisar que el reporte no contenga tokens ni correos antes de hacer commit (los scripts no los
leen, pero es la regla para cualquier evidencia).

## HU-10 — Consultar la auditoría (CA-10.1)

1. Dar de alta un AUDITOR con MFA (procedimiento del inicio de este documento).
2. Iniciar sesión en la SPA con esa cuenta y abrir «Auditoría»; filtrar por «Publicación de
   proyecto» y un rango de fechas.
3. Con un token de DONANTE o de GESTOR, `GET /v1/audit` → **403**.

## HU-12 — Verified Permissions (CA-12.1, CA-12.2)

1. Desplegar con el motor externo:

   ```bash
   sam deploy --parameter-overrides AuthorizationEngine=verified-permissions
   ```

2. Repetir en Postman T03 (DONANTE crea un proyecto → 403), T09 (otro DONANTE lee una donación
   → 404) y T12 (GESTOR lee historiales → 403), más los casos permitidos.
3. En CloudTrail, buscar eventos `IsAuthorized` (fuente `verifiedpermissions.amazonaws.com`).
4. Volver al motor embebido con `AuthorizationEngine=embedded` si se prefiere para la demo.

## T02, T04–T09, T11 y T13 en un solo paso (`npm run evidence:api`)

Requiere dos usuarios del grupo DONANTE (por ejemplo `donante1` y `donante2`) y el puerto 5173
libre. En PowerShell, desde `backend/`, una línea por vez:

```powershell
$env:API_URL='<ApiUrl>'
```

```powershell
$env:COGNITO_DOMAIN='<CognitoDomain>'
```

```powershell
$env:COGNITO_CLIENT_ID='<UserPoolClientId>'
```

```powershell
npm run evidence:api | Out-File -Encoding utf8 ../evidence/api/report.md
```

El script abre el managed login dos veces (primero A, luego B; cerrar la pestaña de A cuando diga
«Listo»). La contraseña se escribe solo en Cognito y los tokens no se imprimen. Crea una donación de
S/ 5 y otra de S/ 1 (confirmada en T08) en el primer proyecto publicado, y T13 espera a que caduque
el access token (hasta 15 minutos). En Windows PowerShell 5.1 el archivo puede quedar con los
acentos dañados: revisar el reporte antes de hacer commit.
