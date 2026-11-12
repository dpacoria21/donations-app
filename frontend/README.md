# frontend

SPA de la Plataforma de Donaciones Seguras: **React 19 + TypeScript + Vite 8 + Tailwind CSS 4**,
según [design.md](../design.md) §2. En AWS se publicará en un bucket S3 privado detrás de
CloudFront con OAC (fase 5).

Hoy incluye el **catálogo y el detalle de proyectos** con montos en PEN, el **inicio y cierre de
sesión con Cognito**, la página **Mi cuenta** con el historial propio y las **pantallas del
GESTOR** para crear, editar y publicar proyectos. Usa React Router 8, TanStack Query 5,
oidc-client-ts 3, React Hook Form 7 y Zod 4.

**Dinero:** el API trabaja en céntimos enteros (AD-04). Los formularios reciben soles
(«4500,50») y [src/lib/format.ts](src/lib/format.ts) los convierte a céntimos sin pasar por
`float`. La validación del formulario es solo para la experiencia de uso: el backend valida
de nuevo con sus propias reglas.

## Configuración

```bash
cp .env.template .env
```

Las variables `VITE_*` se incrustan en el bundle y son **públicas**: nunca poner secretos en
`.env`. El app client de Cognito para la SPA es público (sin secreto) y usa PKCE.

| Variable                    | Uso                                                            | Salida de la pila  |
| --------------------------- | -------------------------------------------------------------- | ------------------ |
| `VITE_API_BASE_URL`         | URL base del API (local: `http://127.0.0.1:3000`)              | `ApiUrl`           |
| `VITE_COGNITO_AUTHORITY`    | Emisor OIDC del user pool                                      | `CognitoIssuer`    |
| `VITE_COGNITO_CLIENT_ID`    | App client público de la SPA                                   | `UserPoolClientId` |
| `VITE_COGNITO_DOMAIN`       | Dominio del managed login de Cognito                           | `CognitoDomain`    |
| `VITE_COGNITO_REDIRECT_URI` | Callback tras el login (`http://localhost:5173/auth/callback`) | —                  |
| `VITE_COGNITO_LOGOUT_URI`   | Destino tras cerrar sesión (`http://localhost:5173/`)          | —                  |

Si falta alguna variable de Cognito, la SPA funciona sin el botón de sesión y «Mi cuenta»
explica qué completar. Las URLs de callback y de logout deben coincidir exactamente con las
del app client (parámetros `CallbackUrls` y `LogoutUrls` de `infra/template.yaml`).

## Inicio de sesión (HU-03)

- **Authorization Code + PKCE** con el managed login de Cognito; sin flujo implícito y sin
  secreto en el navegador (CA-03.1). Lo implementa [src/auth/oidc.ts](src/auth/oidc.ts).
- **Tokens solo en memoria** (`InMemoryWebStorage`), nunca en `localStorage` ni
  `sessionStorage` (CA-NF11.1). Consecuencia: al recargar la página hay que volver a iniciar
  sesión. En `sessionStorage` solo queda, durante el login, el estado temporal con el
  `code_verifier` de PKCE.
- El access token dura 15 minutos y se renueva con el refresh token, sin iframes.
- **Cerrar sesión** revoca el refresh token (`POST /oauth2/revoke`), borra los tokens de
  memoria y cierra la sesión del managed login (`/logout`) (CA-03.3). Un access token ya
  emitido sigue siendo válido en el API hasta que expira (CA-03.4, T13).
- La interfaz muestra los grupos del token solo como información. Ocultar un botón no protege
  nada: el API vuelve a comprobar token, scope y grupo en cada solicitud (CA-NF02.2).

## Rutas

| Ruta                         | Contenido                                               |
| ---------------------------- | ------------------------------------------------------- |
| `/`                          | Catálogo de proyectos publicados (HU-01)                |
| `/proyectos/:projectId`      | Detalle, avance y última actualización (HU-02, HU-09)   |
| `/gestion`                   | GESTOR: todos los proyectos, publicar (HU-08)           |
| `/gestion/nuevo`             | GESTOR: crear un borrador                               |
| `/gestion/:projectId/editar` | GESTOR: editar título, descripción y meta (decisión D2) |
| `/cuenta`                    | Datos de la sesión e historial propio (HU-07)           |
| `/auth/callback`             | Destino del managed login; canjea el código por tokens  |

El enlace «Gestión» solo aparece para usuarios del grupo GESTOR, pero eso es solo orientación:
el API rechaza con 403 a cualquier otro rol, y la interfaz muestra ese error tal cual.

## Comandos

```bash
npm install
npm run dev      # http://localhost:5173 (con el backend corriendo en el puerto 3000)
npm run check    # lint + formato + typecheck + tests + build
```

Para probar el login en local, el backend también necesita `COGNITO_USER_POOL_ID` y
`COGNITO_CLIENT_ID` en su `.env` (ver [backend/README.md](../backend/README.md)).
