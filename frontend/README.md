# frontend

SPA de la Plataforma de Donaciones Seguras: **React 19 + TypeScript + Vite 8 + Tailwind CSS 4**,
según [design.md](../design.md) §2. En AWS se publicará en un bucket S3 privado detrás de
CloudFront con OAC.

Por ahora es solo el esqueleto: una página con el aviso de prototipo académico y una
comprobación de la conexión con el API (`GET /v1/projects`). React Router, TanStack Query,
React Hook Form, Zod y oidc-client-ts se añadirán en las fases correspondientes de
[tasks.md](../tasks.md).

## Configuración

```bash
cp .env.template .env
```

Las variables `VITE_*` se incrustan en el bundle y son **públicas**: nunca poner secretos en
`.env`. El app client de Cognito para la SPA es público (sin secreto) y usa PKCE.

| Variable                    | Uso                                               |
| --------------------------- | ------------------------------------------------- |
| `VITE_API_BASE_URL`         | URL base del API (local: `http://127.0.0.1:3000`) |
| `VITE_COGNITO_AUTHORITY`    | Emisor OIDC del user pool (fase 2)                |
| `VITE_COGNITO_CLIENT_ID`    | App client público de la SPA (fase 2)             |
| `VITE_COGNITO_DOMAIN`       | Dominio del managed login de Cognito (fase 2)     |
| `VITE_COGNITO_REDIRECT_URI` | Callback tras el login                            |
| `VITE_COGNITO_LOGOUT_URI`   | Destino tras cerrar sesión                        |

## Comandos

```bash
npm install
npm run dev      # http://localhost:5173 (con el backend corriendo en el puerto 3000)
npm run check    # lint + formato + typecheck + tests + build
```
