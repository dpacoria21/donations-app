# backend

API de la Plataforma de Donaciones Seguras: handlers **AWS Lambda (Node.js 24, TypeScript)**
detrás de **API Gateway HTTP API**, según [design.md](../design.md). Por ahora incluye los
endpoints públicos de proyectos, que leen de DynamoDB en AWS y de datos de prueba en memoria en
local. La infraestructura está en [infra/template.yaml](../infra/template.yaml) (AWS SAM).

## Requisitos

- Node.js 24 (`node --version`). Node ejecuta TypeScript directamente (_type stripping_),
  por eso los imports llevan la extensión `.ts`.

## Configuración

```bash
cp .env.template .env
```

`.env` no se sube a Git; `.env.template` documenta cada variable. **No guardar llaves de acceso
de AWS** en `.env`: el proyecto usa credenciales temporales con
`aws login --profile donations-dev` (CA-NF03.2, CA-NF03.3). Los scripts `dev` y `start` cargan
`.env` con `node --env-file-if-exists`.

| Variable                    | Uso                                                          |
| --------------------------- | ------------------------------------------------------------ |
| `PORT`                      | Puerto del API local (3000)                                  |
| `CORS_ALLOWED_ORIGINS`      | Orígenes del frontend admitidos, separados por comas         |
| `AWS_REGION`, `AWS_PROFILE` | Región seleccionada (`us-east-2`) y perfil de AWS CLI        |
| `STAGE`                     | Stage de API Gateway (`academic`)                            |
| `*_TABLE`                   | Nombres de las tablas DynamoDB (fase 2)                      |
| `COGNITO_*`                 | Identificadores públicos del user pool y app client (fase 2) |

## Comandos

```bash
npm install          # instala las versiones exactas de package-lock.json
npm run dev          # API local en http://127.0.0.1:3000 (se reinicia al guardar)
npm run check        # lint + formato + typecheck + tests + build
```

| Script                  | Qué hace                                                       |
| ----------------------- | -------------------------------------------------------------- |
| `npm run dev`           | Servidor local con recarga automática                          |
| `npm start`             | Servidor local sin recarga                                     |
| `npm run lint`          | ESLint con reglas estrictas de typescript-eslint               |
| `npm run lint:api`      | Valida el contrato OpenAPI `../docs/api.yaml` con Redocly      |
| `npm run format:check`  | Comprueba el formato con Prettier (`npm run format` lo aplica) |
| `npm run typecheck`     | `tsc --noEmit`                                                 |
| `npm test`              | Pruebas con Vitest                                             |
| `npm run build`         | Empaqueta los handlers con esbuild en `dist/<módulo>/`         |
| `npm run seed:projects` | Carga los proyectos de prueba en la tabla `PROJECTS_TABLE`     |

## API local (solo desarrollo)

`npm run dev` levanta [dev/app.ts](dev/app.ts), que imita las rutas de API Gateway HTTP API
(payload 2.0) e invoca **los mismos handlers Lambda** que se desplegarán. Solo responde JSON:
no sirve páginas. Aplica CORS a los orígenes de `CORS_ALLOWED_ORIGINS`, igual que hará la
`CorsConfiguration` de HTTP API, para que el frontend (`http://localhost:5173`) pueda llamarlo.

Con `PROJECTS_TABLE` y `DONATIONS_TABLE` vacías usa datos en memoria. Si se completan con los
nombres de las tablas desplegadas (y hay sesión de `aws login`), el API local lee de DynamoDB
real.

En las **rutas protegidas** el servidor local hace lo mismo que el JWT authorizer: verifica el
token con las llaves públicas del user pool (`aws-jwt-verify`) y exige uno de los scopes de la
ruta. Por eso necesita `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID` (salidas `UserPoolId` y
`UserPoolClientId` de la pila). No hay un modo «sin autenticación»: sin esas variables, las
rutas protegidas responden 401.

## Despliegue en AWS (lo ejecuta una persona del equipo)

Los asistentes de IA no despliegan ni ejecutan comandos sobre la cuenta sin supervisión
(design.md §10). Requisitos: AWS SAM CLI y una sesión con credenciales temporales.

```bash
aws login --region us-east-2 --profile donations-dev
```

1. Empaquetar los handlers: en `backend/`, `npm run build`.
2. Validar y desplegar desde `infra/` (la configuración está en
   [infra/samconfig.toml](../infra/samconfig.toml); SAM muestra el change set y pide
   confirmación):

   ```bash
   cd ../infra
   sam validate
   sam deploy
   ```

   Un comando por línea: Windows PowerShell 5.1 no admite `&&`. No ejecutar `sam build`: el
   código ya llega empaquetado por esbuild.

3. Cargar los proyectos de prueba con el valor de la salida `ProjectsTableName`: copiarlo en
   `PROJECTS_TABLE` de `.env` y ejecutar `npm run seed:projects`.
4. Copiar en el entorno de Postman `postman/academic.postman_environment.json` las salidas
   `ApiUrl` (`baseUrl`), `CognitoDomain` (`cognitoDomain`) y `UserPoolClientId`
   (`cognitoClientId`), y ejecutar la colección.

Para eliminar todo: `sam delete` desde `infra/`. Las tablas, el user pool y los log groups se
borran con la pila.

### Usuarios de prueba (Cognito)

El pool no permite el autorregistro: el equipo crea las cuentas y les asigna su grupo. Usar
correos ficticios (`@example.com`) y una contraseña temporal que Cognito obliga a cambiar en el
primer inicio de sesión (mínimo 12 caracteres, con mayúscula, minúscula y número). Reemplazar
`POOL_ID` por la salida `UserPoolId`:

```bash
aws cognito-idp admin-create-user --user-pool-id POOL_ID --username donante1@example.com --user-attributes Name=email,Value=donante1@example.com Name=email_verified,Value=true --temporary-password "CambiarEsta123" --message-action SUPPRESS
```

```bash
aws cognito-idp admin-add-user-to-group --user-pool-id POOL_ID --username donante1@example.com --group-name DONANTE
```

Repetir con `gestor1@example.com` (grupo `GESTOR`) y `auditor1@example.com` (grupo
`AUDITOR`). El MFA TOTP de GESTOR y AUDITOR se configura en la fase 5 (HU-11, decisión D5).
Las contraseñas no se guardan en el repositorio.

## Pruebas con Postman

En [postman/](postman/) hay una colección con pruebas automáticas (T01, CA-02.1, CA-02.2,
CA-09.1, CA-09.2) y un entorno local:

1. En Postman: **Import** → `donations-api.postman_collection.json` y
   `local.postman_environment.json`.
2. Seleccionar el entorno **Donaciones Seguras — local** y levantar el API con `npm run dev`.
3. Ejecutar la colección con **Run collection**.

Para el stage desplegado está `academic.postman_environment.json`: reemplazar sus valores con
las salidas de la pila (ver el paso 4 del despliegue).

La carpeta **Donaciones (protegido)** contiene T02 (sin token → 401), T11 (token alterado →
401; ID token → rechazado) y el historial propio. Para obtener un access token: abrir
«HU-07 — Historial propio» → pestaña **Authorization** → **Get New Access Token**. Postman
abre el managed login de Cognito con Authorization Code + PKCE y vuelve a
`https://oauth.pstmn.io/v1/callback`, que está registrada en el app client. Para la prueba del
ID token, copiar el `id_token` que muestra Postman en la variable `idToken` del entorno.

La carpeta **Proyectos (gestión)** necesita un token de un usuario **GESTOR** (se obtiene en la
pestaña Authorization de la carpeta). Se ejecuta en orden: crear (guarda `newProjectId`),
datos inválidos → 400, editar, meta menor que lo recaudado → 409, publicar, publicar de nuevo
→ 409 y listar todos. **T03** usa el token de un usuario DONANTE y espera 403.

## Endpoints implementados

| Método | Ruta                               | Acceso                         | Respuestas                        |
| ------ | ---------------------------------- | ------------------------------ | --------------------------------- |
| GET    | `/v1/projects`                     | Público                        | 200                               |
| GET    | `/v1/projects/{projectId}`         | Público (solo PUBLICADO)       | 200 / 404                         |
| GET    | `/v1/projects/{projectId}/stats`   | Público (solo PUBLICADO)       | 200 / 404                         |
| GET    | `/v1/donations/me`                 | `api/donations.read` + DONANTE | 200 / 401 / 403                   |
| GET    | `/v1/manage/projects`              | `api/projects.write` + GESTOR  | 200 / 401 / 403                   |
| POST   | `/v1/projects`                     | `api/projects.write` + GESTOR  | 201 / 400 / 401 / 403             |
| PATCH  | `/v1/projects/{projectId}`         | `api/projects.write` + GESTOR  | 200 / 400 / 401 / 403 / 404 / 409 |
| PATCH  | `/v1/projects/{projectId}/publish` | `api/projects.write` + GESTOR  | 200 / 401 / 403 / 404 / 409       |

La edición sigue la decisión D2 de [tasks.md](../tasks.md): título, descripción y meta en
cualquier estado; la meta nunca por debajo de lo recaudado; no se puede despublicar.

Los errores de los handlers usan el formato `{ code, message, requestId }`, y cada solicitud
escribe una línea de log JSON con `requestId`, acción, resultado, código HTTP y duración. Los
401 y 403 del JWT authorizer los emite API Gateway con su formato nativo `{ message }`.

**Autorización en dos capas:** API Gateway verifica el access token y el scope de la ruta; la
Lambda vuelve a exigir un access token (`token_use`), el scope y el grupo, y toma el `sub` solo
de los claims verificados (CA-04.3).

El contrato completo está en [docs/api.yaml](../docs/api.yaml) (OpenAPI 3.1). La prueba
`test/openapi.test.ts` falla si se añade una ruta sin documentarla o si una respuesta deja de
coincidir con su esquema.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) ejecuta, en cada PR y push a `main`,
`npm ci`, `npm audit` (producción: falla desde `moderate`; todo: falla desde `high`) y
`npm run check`, para el backend y el frontend.

## Estructura

```text
backend/
├── src/
│   ├── projects/   # modelo, repositorio (memoria → DynamoDB) y handlers públicos
│   ├── donations/  # historial propio (GET /v1/donations/me); creación en la fase 4
│   ├── authz/      # identidad, grupos y scopes desde claims del JWT authorizer
│   └── shared/     # errores, respuestas HTTP y logger JSON
├── dev/            # API local para Postman y el frontend (no se despliega)
├── scripts/        # build con esbuild y carga de datos de prueba
├── postman/        # colección y entornos de Postman (local y academic)
└── test/           # pruebas Vitest, incluida la revisión de infra/template.yaml
```

## Pendiente

- Login en el frontend (fase 2, parte 3).
- Donaciones: intención, idempotencia y simulación (fases 4 y 5); módulo `audit`.
