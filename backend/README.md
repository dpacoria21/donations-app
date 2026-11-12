# backend

API de la Plataforma de Donaciones Seguras: handlers **AWS Lambda (Node.js 24, TypeScript)**
detrás de **API Gateway HTTP API**, según [design.md](../design.md). Esta primera versión
solo incluye el esqueleto y los endpoints públicos de proyectos, con datos de prueba en memoria.

## Requisitos

- Node.js 24 (`node --version`). Node ejecuta TypeScript directamente (_type stripping_),
  por eso los imports llevan la extensión `.ts`.

## Comandos

```bash
npm install          # instala las versiones exactas de package-lock.json
npm run dev          # servidor local en http://127.0.0.1:3000/ (se reinicia al guardar)
npm run check        # lint + formato + typecheck + tests + build
```

| Script                 | Qué hace                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `npm run dev`          | Servidor local con recarga automática                          |
| `npm start`            | Servidor local sin recarga                                     |
| `npm run lint`         | ESLint con reglas estrictas de typescript-eslint               |
| `npm run format:check` | Comprueba el formato con Prettier (`npm run format` lo aplica) |
| `npm run typecheck`    | `tsc --noEmit`                                                 |
| `npm test`             | Pruebas con Vitest                                             |
| `npm run build`        | Empaqueta los handlers con esbuild en `dist/`                  |

## Páginas de prueba (solo desarrollo local)

`npm run dev` levanta [dev/app.ts](dev/app.ts), que:

- imita las rutas de API Gateway HTTP API (payload 2.0) e invoca **los mismos handlers Lambda**
  que se desplegarán;
- sirve las páginas HTML de [public/](public/): catálogo (`/`) y detalle
  (`/proyecto.html?id=…`), con enlaces para probar los casos 404.

Estas páginas **no se despliegan**. En AWS, el frontend será la SPA React de `../frontend`
en S3 + CloudFront.

## Endpoints implementados

| Método | Ruta                             | Acceso                   | Respuestas |
| ------ | -------------------------------- | ------------------------ | ---------- |
| GET    | `/v1/projects`                   | Público                  | 200        |
| GET    | `/v1/projects/{projectId}`       | Público (solo PUBLICADO) | 200 / 404  |
| GET    | `/v1/projects/{projectId}/stats` | Público (solo PUBLICADO) | 200 / 404  |

Los errores usan el formato `{ code, message, requestId }`, y cada solicitud escribe una
línea de log JSON con `requestId`, acción, resultado, código HTTP y duración.

## Estructura

```text
backend/
├── src/
│   ├── projects/   # modelo, repositorio (memoria → DynamoDB) y handlers públicos
│   ├── authz/      # identidad desde claims del JWT authorizer, RBAC por grupo
│   └── shared/     # errores, respuestas HTTP y logger JSON
├── dev/            # servidor local (no se despliega)
├── public/         # páginas HTML de prueba (no se despliegan)
└── test/           # pruebas Vitest
```

## Pendiente

- Repositorio DynamoDB y plantilla SAM (`infra/template.yaml`) con un rol IAM por función.
- Cognito (PKCE, grupos, MFA TOTP) y rutas protegidas con scopes.
- Módulos `donations` (intención, idempotencia, simulación, historial) y `audit`.
- CI en GitHub Actions ejecutando `npm run check`.
