# backend

API de la Plataforma de Donaciones Seguras: handlers **AWS Lambda (Node.js 24, TypeScript)**
detrás de **API Gateway HTTP API**, según [design.md](../design.md). Esta primera versión
solo incluye el esqueleto y los endpoints públicos de proyectos, con datos de prueba en memoria.

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

| Script                 | Qué hace                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `npm run dev`          | Servidor local con recarga automática                          |
| `npm start`            | Servidor local sin recarga                                     |
| `npm run lint`         | ESLint con reglas estrictas de typescript-eslint               |
| `npm run lint:api`     | Valida el contrato OpenAPI `../docs/api.yaml` con Redocly      |
| `npm run format:check` | Comprueba el formato con Prettier (`npm run format` lo aplica) |
| `npm run typecheck`    | `tsc --noEmit`                                                 |
| `npm test`             | Pruebas con Vitest                                             |
| `npm run build`        | Empaqueta los handlers con esbuild en `dist/`                  |

## API local (solo desarrollo)

`npm run dev` levanta [dev/app.ts](dev/app.ts), que imita las rutas de API Gateway HTTP API
(payload 2.0) e invoca **los mismos handlers Lambda** que se desplegarán. Solo responde JSON:
no sirve páginas. Aplica CORS a los orígenes de `CORS_ALLOWED_ORIGINS`, igual que hará la
`CorsConfiguration` de HTTP API, para que el frontend (`http://localhost:5173`) pueda llamarlo.

## Pruebas con Postman

En [postman/](postman/) hay una colección con pruebas automáticas (T01, CA-02.1, CA-02.2,
CA-09.1, CA-09.2) y un entorno local:

1. En Postman: **Import** → `donations-api.postman_collection.json` y
   `local.postman_environment.json`.
2. Seleccionar el entorno **Donaciones Seguras — local** y levantar el API con `npm run dev`.
3. Ejecutar la colección con **Run collection**.

Cuando exista el stage desplegado, se añadirá otro entorno con su `baseUrl`.

## Endpoints implementados

| Método | Ruta                             | Acceso                   | Respuestas |
| ------ | -------------------------------- | ------------------------ | ---------- |
| GET    | `/v1/projects`                   | Público                  | 200        |
| GET    | `/v1/projects/{projectId}`       | Público (solo PUBLICADO) | 200 / 404  |
| GET    | `/v1/projects/{projectId}/stats` | Público (solo PUBLICADO) | 200 / 404  |

Los errores usan el formato `{ code, message, requestId }`, y cada solicitud escribe una
línea de log JSON con `requestId`, acción, resultado, código HTTP y duración.

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
│   ├── authz/      # identidad desde claims del JWT authorizer, RBAC por grupo
│   └── shared/     # errores, respuestas HTTP y logger JSON
├── dev/            # API local para Postman y el frontend (no se despliega)
├── postman/        # colección y entorno de Postman
└── test/           # pruebas Vitest
```

## Pendiente

- Repositorio DynamoDB y plantilla SAM (`infra/template.yaml`) con un rol IAM por función.
- Cognito (PKCE, grupos, MFA TOTP) y rutas protegidas con scopes.
- Módulos `donations` (intención, idempotencia, simulación, historial) y `audit`.
