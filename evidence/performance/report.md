# Rendimiento de las rutas GET (CA-NF05.1, CA-NF05.2)

- Fecha: 2026-11-12T17:33:45.759Z
- Herramienta: `npm run evidence:perf` (Node.js v24.16.0, `fetch` nativo).
- API: stage `academic` en us-east-2.
- Proyectos publicados en el catálogo: **54** (mínimo exigido: 50).
- Método: 5 solicitudes de calentamiento por ruta (no se cuentan, excluyen el cold start) y 100 solicitudes secuenciales medidas por ruta. Se mide el tiempo total de cada solicitud vista por el cliente, incluida la descarga del cuerpo.
- Condiciones: un solo cliente, sin concurrencia, conexión HTTPS reutilizada (keep-alive).
- Cliente: equipo del integrante en Perú → us-east-2 (Ohio). Es una condición más
  exigente que «un cliente cercano a la región», porque incluye la latencia de red Perú–EE. UU.
- Datos: 4 proyectos reales del stage y 50 «Proyecto de carga NN» (`npm run seed:projects -- --load`),
  borrados después de medir.

| Ruta                                 | n   | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) | Errores | ¿p95 ≤ 1500 ms? |
| ------------------------------------ | --- | -------- | -------- | -------- | -------- | ------- | --------------- |
| `GET /v1/projects`                   | 100 | 140      | 199      | 241      | 310      | 0       | Sí              |
| `GET /v1/projects/{projectId}`       | 100 | 138      | 152      | 161      | 182      | 0       | Sí              |
| `GET /v1/projects/{projectId}/stats` | 100 | 133      | 147      | 160      | 160      | 0       | Sí              |

**Resultado: cumple CA-NF05.1.**
