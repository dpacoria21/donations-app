# Tareas — Plataforma de Donaciones Seguras (2026)

**Fuentes:** [requirements.md](./requirements.md) · [design.md](./design.md)
**Última actualización:** 2026-11-12

Lista incremental para seguir el avance del MVP. Las fases siguen el plan del design.md §9.
Cada tarea cita los identificadores HU/CA/T que cubre, para mantener la trazabilidad que pide
requirements.md §7.

## Cómo usar este archivo

- `- [x]` hecho · `- [ ]` pendiente. Si una tarea está a medias, se deja sin marcar y se
  explica qué falta.
- Una tarea se marca como hecha cuando: (1) entró por un PR revisado por otro integrante,
  (2) tiene pruebas, y (3) el CI está en verde. Lo que dependa de AWS necesita además
  evidencia en el stage desplegado.
- Al marcarla, añadir el enlace al PR, por ejemplo: `(PR #12)`.
- Las fases son incrementales. Primero el backend de cada fase y luego su parte del frontend.
- **MVP obligatorio:** HU-01 a HU-09, HU-11 y RNF-HU-01 a RNF-HU-11. **Extensión:** HU-10 y
  HU-12, solo cuando el MVP esté completo.

## Resumen de avance

| Fase | Tema                                     | Estado    |
| ---- | ---------------------------------------- | --------- |
| 0    | Cuenta AWS, repositorio y documentos     | Completa¹ |
| 1    | Esqueletos (backend y frontend) y CI     | Completa  |
| 2    | Infraestructura base y autenticación     | Completa² |
| 3    | Proyectos y catálogo                     | Completa  |
| 4    | Donaciones e idempotencia                | En curso  |
| 5    | Simulación, concurrencia, MFA y frontend | En curso  |
| 6    | Endurecimiento y evidencias              | En curso  |
| 7    | Extensiones (opcional)                   | En curso  |
| 8    | Cierre, entrega y limpieza               | Pendiente |

¹ Falta solo invitar al resto del equipo a la cuenta AWS con MFA, cuando se sumen (D3).
² Falta T11 con un ID token en Postman, para cerrar la decisión D4.

---

## Fase 0 — Cuenta AWS, repositorio y documentos (día 1)

Guía de los pasos manuales: [docs/cuenta-aws.md](docs/cuenta-aws.md). El 2026-11-12 un
asistente de IA ejecutó las verificaciones y creó el presupuesto desde la consola y CloudShell,
con la sesión del propietario y bajo su supervisión (design.md §10; ver `AI_USAGE.md`).

- [x] Identidad de trabajo sin `root`: CloudShell muestra el rol asumido
      `AccountFullAccessRole` (CA-NF03.3).
- [x] Región `us-east-2` confirmada en AWS Settings → Projects → Additional info (CA-NF09.1).
- [x] Plan **Free** confirmado en AWS Settings → Billing: 119.93 USD de crédito, 176 días
      restantes (hasta el 2027-05-05) y 0.07 USD consumidos en noviembre (CA-NF09.1).
- [x] Según la [lista oficial](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html)
      (revisada el 2026-11-12), el Free Tier incluye todos los servicios del diseño: Lambda,
      API Gateway, DynamoDB, Cognito, S3, CloudFront, CloudWatch y CloudWatch Logs,
      CloudFormation, Serverless Application Repository, IAM, STS, CloudTrail, Budgets,
      Verified Permissions y CloudShell (CA-NF09.1). Restricciones que afectan al diseño:
  - No hay Lambda@Edge ni funciones multirregión o entre regiones.
  - IAM Access Analyzer no está disponible, salvo la _policy validation_. Para T10 se usará
    la validación de políticas o el IAM Policy Simulator.
  - El envío de SMS (End User Messaging SMS) solo existe en el plan de pago: el MFA de Cognito
    debe ser TOTP, como ya prevé el diseño.
- [x] Alerta de AWS Budgets `alerta-mensual-5usd`: 5 USD al mes sin restar créditos; avisa por
      correo al superar el 80% del gasto real y el 100% del previsto (CA-NF09.1).
- [x] MFA activo en el inicio de sesión del propietario de la cuenta (CA-NF03.3; confirmado
      por el propietario el 2026-11-12).
- [ ] Resto del equipo: hoy el único _team member_ es el propietario. Al invitar a cada
      integrante, confirmar que su inicio de sesión usa MFA y que no tiene llaves de acceso de
      larga duración (CA-NF03.3). Ver la decisión D3.
- [x] Repositorio en GitHub con `main` protegida mediante un ruleset: sin borrado ni
      _force push_, PR obligatorio y CI (`check (backend)`, `check (frontend)`) en verde
      (design.md §8). Subir las aprobaciones requeridas a 1 cuando haya otros integrantes.
- [x] Secret scanning con _push protection_ y alertas de Dependabot activos en GitHub
      (design.md §6.2).
- [x] AWS SAM CLI 1.172.1 instalado con `winget` (`sam --version`); lo necesita la fase 2.
      Abrir una terminal nueva para que el `PATH` lo reconozca.
- [x] Inventario de la cuenta (2026-11-12, `us-east-2`):
  - No hay EC2, NAT Gateway, IP elásticas, RDS, CloudFront ni API Gateway: nada cobra solo
    por existir.
  - User pool de la demo Java `us-east-2_yAC3TdllN`: no sirve para este diseño; se borra en la
    fase 8 o antes, cuando el pool nuevo funcione.
  - App de Amplify **notesapp** (otro proyecto) con sus pilas, el user pool
    `us-east-2_KjxacecaQ`, una tabla `Todo-*`, Lambdas auxiliares, dos buckets y log groups
    sin retención. No pertenece a este proyecto: su dueño decide si se borra.
  - Pila `CDKToolkit` y su bucket `cdk-*-assets-*`, de un _bootstrap_ de CDK. SAM no la usa.
- [x] `.gitignore` que excluye `node_modules`, `dist`, `.aws-sam`, `.env*` y `.local/`
      (CA-NF01.2).
- [x] `docs/threat-model.md`: STRIDE por límite de confianza, mapeo a NIST SP 800-207 y a
      OWASP API Top 10, y riesgos residuales (design.md §8). Se actualiza al cerrar cada fase.
- [x] `AI_USAGE.md` con las reglas y la tabla de design.md §10; se añade una fila por PR.
- [x] `docs/cuenta-aws.md`: guía de los pasos manuales de esta fase.
- [x] ~~Actualizar `AGENTS.md`~~: `AGENTS.md` y `CLAUDE.md` se retiraron del repositorio en el
      commit `5d0e50a`. Las reglas para agentes de IA están ahora en `AI_USAGE.md`.

## Fase 1 — Esqueletos (backend y frontend) y CI

- [x] `backend/` con Node.js 24, TypeScript 6.0, ESLint estricto, Prettier, Vitest y esbuild.
      Versiones exactas en `package-lock.json`.
- [x] `src/shared`: errores con el formato `{ code, message, requestId }` sin detalles internos,
      y un log JSON por solicitud con `requestId`, acción, resultado, código HTTP y duración
      (CA-NF07.1).
- [x] `src/authz`: `getIdentity` obtiene `sub` y `cognito:groups` solo de los claims del JWT
      authorizer, y `requireGroup` responde 403 (CA-04.3). Probado de forma unitaria; aún no
      lo usa ninguna ruta.
- [x] API local (`npm run dev`) que imita HTTP API, solo JSON y con CORS para el frontend. Solo
      para desarrollo; no se despliega.
- [x] Configuración con `.env` (ignorado por Git) y `.env.template` documentado en backend y
      frontend, sin llaves de AWS (CA-NF01.2, CA-NF03.2).
- [x] Colección de Postman con entorno local en `backend/postman/` (design.md §9). Ampliarla en
      cada fase y añadir un entorno para el stage desplegado.
- [x] Esqueleto del frontend: React 19, TypeScript, Vite 8, Tailwind 4, ESLint, Prettier, Vitest
      y Testing Library, con la comprobación de conexión al API.
- [x] `.github/workflows/ci.yml`: `npm ci` y `npm run check` (lint, formato, typecheck, tests y
      build) para backend y frontend en cada PR y en cada push a `main`, sin credenciales de
      AWS (CA-NF08.1, CA-NF03.2). Simulado en local; falta verlo en verde en el primer PR.
- [x] `npm audit` en el CI (design.md §6.2). Política decidida:
  - Dependencias de producción: el CI falla con cualquier alerta `moderate` o superior.
  - Todas, incluidas las de desarrollo: el CI falla desde `high`.
  - Las 10 alertas moderadas de ESLint (`minimatch`, GHSA-g3hv-75wg-m249) solo afectan a
    herramientas de desarrollo. La única corrección es bajar ESLint a una versión mayor anterior,
    así que se aceptan y se vigilan con Dependabot.
- [x] `.github/dependabot.yml`: revisión semanal de npm (backend y frontend) y de GitHub Actions.
      Falta activarlo en la configuración del repositorio (fase 0).
- [x] `docs/api.yaml` en OpenAPI 3.1 con los endpoints existentes, ampliándolo en cada fase
      (requirements.md §7). Redocly lo valida en `npm run check`, y
      `backend/test/openapi.test.ts` comprueba que las rutas implementadas y las respuestas
      reales coinciden con el contrato.

## Fase 2 — Infraestructura base y autenticación (día 2)

### Infraestructura (AWS SAM, `infra/template.yaml`)

Parte 1 de la fase: la plantilla está escrita y validada (`sam validate --lint`) y la prueban
`backend/test/template.test.ts` y `backend/test/projects-dynamo.test.ts`. Falta desplegarla.

- [x] HTTP API con el stage `academic`, throttling (10 rps, ráfaga de 20), CORS por lista de
      orígenes y access logs sin IP ni cabeceras. Todos los log groups tienen una retención de
      14 días como máximo (CA-NF07.1, CA-NF01.2, design.md §6.2).
- [x] Tablas DynamoDB en modo on-demand, que se borran con la pila (design.md §5):
  - [x] `Projects`: PK `projectId`, GSI `status-createdAt`.
  - [x] `Donations`: PK `donationId`, GSI `donorSub-createdAt`.
  - [x] `Idempotency`: PK `pk` (`donorSub#createDonation#idempotencyKey`), TTL `expiresAt`.
  - [x] `AuditEvents`: PK `eventType`, SK `sk` (`timestamp#eventId`).
- [x] Un rol IAM explícito por función Lambda, con una sola acción de DynamoDB sobre su tabla o
      índice y escritura solo en su propio log group. No se usa `AWSLambdaBasicExecutionRole`
      porque concede logs sobre `Resource: "*"` (CA-NF03.1, CA-NF03.2).
- [x] Repositorio DynamoDB de proyectos (`Query` sobre el GSI y `GetItem`), que valida con Zod
      lo que lee. Se activa con `PROJECTS_TABLE`; en Lambda, si falta, la función falla en vez
      de servir datos ficticios.
- [x] `npm run build` empaqueta los handlers con esbuild (ESM, minificado, con el AWS SDK
      dentro) y `npm run seed:projects` carga los proyectos de prueba en la tabla.
- [x] Primer `sam deploy` de la pila `donations-academic` en `us-east-2` (2026-11-12, lo
      ejecutó el propietario): 31 recursos en `CREATE_COMPLETE`.
- [x] Comprobado por HTTPS: `GET /v1/projects` → 200 (lee DynamoDB con su rol), proyecto
      inexistente → 404, preflight CORS desde `localhost:5173` → 204, y el endpoint no responde
      por HTTP sin TLS (CA-NF01.1). La Lambda de listado escribe su log JSON en su log group.
- [x] `npm run seed:projects`: el stage devuelve los proyectos publicados desde DynamoDB.
- [x] Login de punta a punta en la SPA contra el user pool desplegado: inicio de sesión, «Mi
      cuenta», pérdida de tokens al recargar y cierre de sesión que vuelve a pedir la
      contraseña.
- [ ] Ejecutar la colección de Postman completa contra el stage y guardar el reporte en
      `evidence/`.

### Identidad (Cognito): HU-03, HU-04 y HU-11

Parte 2 de la fase: definido en `infra/template.yaml` y probado en
`backend/test/template.test.ts`. Falta desplegarlo.

- [x] User pool nuevo (plan Essentials) que pide solo el correo; el `sub` es el identificador.
      Sin autorregistro: el equipo crea las cuentas y les asigna el grupo (CA-NF10.1).
- [x] Grupos `DONANTE`, `GESTOR` y `AUDITOR` (requirements.md §1).
- [x] App client público sin secreto, solo Authorization Code (PKCE) y sin flujos de contraseña
      directos. Callbacks: la SPA local y Postman (CA-03.1).
- [x] Access token e ID token de 15 minutos, refresh token de 12 horas y revocación de tokens
      habilitada (CA-03.3, AD-07).
- [x] Resource server `api` con los scopes `projects.write`, `donations.write`,
      `donations.read` y `audit.read` (design.md §4).
- [x] MFA TOTP disponible en el pool, sin SMS. El alta por usuario se hace en la fase 5
      (CA-11.1).
- [x] Managed login v2 con dominio propio y estilo de Cognito para el app client.
- [x] JWT authorizer que valida el emisor (user pool) y que la audiencia sea el `client_id`.
      `GET /v1/donations/me` declara `AuthorizationScopes: [api/donations.read]`; las rutas
      públicas no tienen authorizer (CA-NF02.1).
- [x] `GET /v1/donations/me` (HU-07): rol propio con solo `Query` sobre el GSI
      `donorSub-createdAt`. La Lambda exige access token, scope y grupo DONANTE, y filtra por
      el `sub` del token (CA-04.2, CA-04.3).
- [x] El servidor local verifica tokens reales de Cognito con `aws-jwt-verify` y aplica los
      scopes igual que el JWT authorizer.
- [ ] Usuarios de prueba ficticios para DONANTE, GESTOR y AUDITOR, creados tras el despliegue
      con los comandos de `backend/README.md`. El visitante no tiene cuenta.

### Pruebas de la fase

- [x] T02 automatizada en el servidor local: sin token → 401 con el formato nativo de API
      Gateway (`backend/test/dev-server.test.ts`).
- [x] T11 automatizada en el servidor local: token alterado → 401; ID token → 403 (pasa la
      firma pero no tiene scopes) y, si llegara a la Lambda, 401 por `token_use`.
- [x] T02 y T11 (token alterado) contra el stage desplegado: 401 `{"message":"Unauthorized"}`
      del JWT authorizer, sin invocar la Lambda.
- [ ] T11 con el ID token, un token vencido y uno de otro app client, con Postman y usuarios
      reales. Anotar el código real del ID token para la decisión D4.

### Frontend

- [x] Esqueleto con Vite, React 19, TypeScript y Tailwind 4, sin Bootstrap (design.md §2).
- [x] React Router 8 y TanStack Query 5. React Hook Form y Zod se añaden con los formularios
      de la fase 3.
- [x] Login con oidc-client-ts (Authorization Code + PKCE) y tokens solo en memoria
      (`InMemoryWebStorage`), no en `localStorage` ni `sessionStorage`. Una prueba lo comprueba
      (CA-03.1, CA-NF11.1).
- [x] Al cerrar sesión: revocar el refresh token (`/oauth2/revoke`), borrar los tokens de
      memoria y cerrar la sesión del managed login (`/logout`) (CA-03.3).
- [x] Página «Mi cuenta» con el historial propio (`GET /v1/donations/me`) y mensajes para
      401 y 403. El retorno tras el login solo acepta rutas internas.
- [x] Login de punta a punta contra el user pool desplegado. Al recargar se pierden los
      tokens, pero la cookie del managed login (~1 h) permite volver a entrar sin contraseña
      hasta cerrar sesión. Mencionarlo en el informe junto a CA-03.4.

## Fase 3 — Proyectos y catálogo (día 3)

### Backend

- [x] `GET /v1/projects`: solo PUBLICADO; lista vacía sin errores (CA-01.1, CA-01.2, CA-01.3).
      Por ahora con datos en memoria.
- [x] `GET /v1/projects/{projectId}`: un ID inexistente, en borrador o mal formado devuelve 404
      sin contenido (CA-02.1, CA-02.2).
- [x] `GET /v1/projects/{projectId}/stats`: solo el acumulado confirmado, sin datos de donantes
      (CA-09.2). CA-09.1 queda completo cuando la simulación de la fase 5 sea lo único que
      incrementa `confirmedAmountCents`.
- [x] Llevar los tres endpoints a DynamoDB y desplegarlos (fase 2).
      Parte 1 de la fase: código, plantilla, OpenAPI y Postman listos; falta desplegarlo.

- [x] `POST /v1/projects`: GESTOR con el scope `api/projects.write`. Valida con Zod título,
      descripción y `goalAmountCents` entero positivo (máximo S/ 1 000 000), rechaza campos extra
      como `status` o `confirmedAmountCents`, crea en BORRADOR y responde 201/400/401/403
      (CA-08.1, CA-04.1).
- [x] `PATCH /v1/projects/{projectId}/publish`: solo GESTOR, con escritura condicionada
      `status = BORRADOR`. Publicar uno ya publicado → 409; inexistente → 404 (CA-08.2).
- [x] `PATCH /v1/projects/{projectId}`: edición según la decisión D2 (título, descripción y
      meta; la meta nunca por debajo de `confirmedAmountCents`, con escritura condicionada).
- [x] `GET /v1/manage/projects`: el GESTOR ve todos los proyectos, también los BORRADOR, con dos
      `Query` al GSI (sin `Scan`).
- [x] Cuatro funciones nuevas en SAM, cada una con su rol y una sola acción de DynamoDB
      (`Query`, `PutItem` o `UpdateItem`). Una prueba verifica que ninguna función de una ruta
      pública puede escribir (T10).
- [x] La vista pública incluye `updatedAt` para mostrar «Última actualización» (D2).
- [x] Desplegado (2026-11-12) y probado desde la SPA contra el stage con `gestor1` y `donante1`:
      validaciones, crear (meta S/ 3 000,50 → 300 050 céntimos), editar solo el título, meta menor
      que lo recaudado → 409 sin cambiar el proyecto, publicar y verlo en el catálogo.
- [x] Auditoría verificada en `AuditEvents`: `PROJECT_CREATE`, `PROJECT_UPDATE` (con
      `changedFields: title`) y `PROJECT_PUBLISH` como SUCCESS, el 409 como REJECTED y el intento
      del donante como DENIED, todos con actor seudonimizado y `requestId`.
- [ ] Ejecutar la carpeta «Proyectos (gestión)» de Postman y guardar el reporte en `evidence/`.
- [x] Módulo `audit` (parte 2 de la fase): cada creación, edición o publicación registra un
      `AuditEvent` con actor seudonimizado (HMAC del `sub`), rol, fecha, `requestId`, acción,
      recurso y resultado, sin tokens, montos ni textos (CA-08.3, CA-10.2):
  - Éxito: el evento se guarda en la **misma transacción** (`TransactWriteItems`) que el
    cambio; no hay cambios sin rastro.
  - 403 → `DENIED`; 400, 404 y 409 → `REJECTED`, registrados aparte. Si ese registro falla, la
    respuesta no cambia y queda un log de error.
  - Las ediciones guardan solo los nombres de los campos cambiados.
  - Limitación: la clave del seudónimo es el `StackId` (no es secreta para quien administra
    la cuenta). En producción sería una clave de KMS o de Secrets Manager.

### Pruebas de la fase

- [x] T01 unitaria: el visitante ve 200 y ningún borrador (CA-01.1, CA-01.2).
- [x] T01 contra el stage desplegado: solo devuelve los proyectos PUBLICADO (fase 2).
- [x] T03 automatizada: un DONANTE (incluso con el scope) intenta crear, editar o publicar → 403,
      en el handler y a través del servidor local (CA-04.1).
- [x] T03 contra el stage desplegado (desde la SPA con `donante1`): 403 de la Lambda (el token
      tenía el scope, no el grupo), evento DENIED en la auditoría y ningún proyecto creado.
- [x] T12 desde la SPA: «Mi cuenta» de un GESTOR recibe 403 al pedir `/v1/donations/me`.

### Frontend

Parte 3 de la fase: probado con 57 pruebas de interfaz y revisado en el navegador contra el
stage desplegado (móvil y escritorio).

- [x] Catálogo con nombre, finalidad, meta y suma confirmada en formato PEN, barra de avance
      accesible y un estado vacío comprensible (HU-01, CA-09.1, CA-01.3).
- [x] Detalle con identificador, descripción, estado, avance confirmado y «Última
      actualización», y una página 404 para proyectos inexistentes o en borrador (HU-02).
- [x] Pantallas del GESTOR (`/gestion`) para listar, crear, editar y publicar proyectos, con
      React Hook Form + Zod. La meta se escribe en soles y se envía en céntimos enteros sin pasar
      por `float`; una edición envía solo los campos cambiados (HU-08, D2).
- [x] Formularios accesibles: etiquetas, ayudas y errores asociados con `aria-describedby`, y
      `aria-invalid` en los campos con error (CA-NF06.2).
- [x] Los errores 403 y 409 del API se muestran tal cual: la interfaz no decide permisos.
- [x] Las páginas del GESTOR se cargan bajo demanda (el bundle principal pasó de 501 a 375 KB).
- [x] Gestión probada con un usuario GESTOR real contra el stage desplegado. Corregido tras la
      prueba: el aviso del formulario ya no se acumula con el de publicar.

## Fase 4 — Donaciones e idempotencia (día 4)

Código, plantilla, OpenAPI y Postman listos y probados (167 pruebas de backend, 65 de
frontend). Falta desplegar y repetir las pruebas contra el stage.

### Backend

- [x] Esquema Zod: `projectId` UUID y `amountCents` entero entre 100 y 100000, sin otros campos.
      La cabecera `Idempotency-Key` es obligatoria y debe ser un UUID (CA-05.1, CA-05.2).
- [x] `POST /v1/donations`: DONANTE con el scope `api/donations.write`. El `donorSub` sale del
      token; un `donorSub` en el body se rechaza (CA-05.3). Proyecto inexistente → 404; no
      PUBLICADO → 409; datos inválidos → 400. Ningún error modifica el acumulado (CA-05.2).
- [x] Un solo `TransactWriteItems` con 4 operaciones: el `IdempotencyRecord`
      (`attribute_not_exists(pk)`), la donación `PENDIENTE_SIMULACION`, un `ConditionCheck` de
      que el proyecto siga PUBLICADO y el `AuditEvent` `DONATION_CREATE` (AD-05, CA-05.4).
- [x] Misma clave y mismo `payloadHash` (SHA-256 del body normalizado) → la respuesta guardada,
      con `Idempotency-Replayed: true`; hash distinto → 409. Si dos solicitudes con la misma
      clave llegan a la vez, la que pierde la transacción repite la respuesta de la ganadora
      (CA-05.4, design.md §5). La clave es por usuario y caduca a las 24 h (TTL).
- [x] No se piden ni almacenan tarjeta, CVV, cuenta bancaria, DNI ni otros datos de pago; el
      esquema estricto los rechaza con 400 (CA-05.5).
- [x] `GET /v1/donations/me`: solo los registros del `sub` autenticado, con fecha, importe,
      proyecto y estado (CA-07.1). Un GESTOR recibe 403 (CA-04.2).
- [x] `GET /v1/donations/{donationId}` (decisión D1): solo la propia; una ajena responde 404,
      igual que una inexistente (CA-07.2).
- [x] Dos funciones nuevas en SAM con roles mínimos. La de creación tiene `ConditionCheckItem`
      sobre Projects y escritura solo en Idempotency, Donations y AuditEvents.
- [ ] Desplegar (`npm run build` y `sam deploy`) y ejecutar la carpeta «Donaciones (protegido)»
      de Postman contra el stage.

### Pruebas de la fase

- [x] T04 automatizada: montos 0, 99, 100001, negativos, no enteros o en texto → 400 (CA-05.2).
- [x] T05 automatizada: intención válida → 201, estado pendiente, sin cargo y sin cambiar el
      acumulado del proyecto (CA-05.1).
- [x] T06 automatizada: misma clave y mismo payload → el mismo resultado y una sola donación;
      también con el body reordenado (CA-05.4).
- [x] T07 automatizada: misma clave con un payload distinto → 409 (CA-05.4).
- [x] 10 solicitudes simultáneas con la misma clave → una sola donación. Una prueba de mutación
      confirmó que falla si se quita la comprobación de la clave.
- [x] T09 automatizada: un donante consulta una donación ajena → 404, idéntico a uno inexistente
      y sin filtrar datos (CA-07.2).
- [x] T12 automatizada: un gestor consulta el historial o una donación → 403 (CA-04.2).
- [ ] T04–T07 y T09 contra el stage desplegado con Postman (T09 con dos donantes).

### Frontend

- [x] Formulario de donación en el detalle del proyecto con importe en PEN (S/ 1.00 a
      S/ 1,000.00), etiquetas y errores accesibles. Una `Idempotency-Key` por intención,
      reutilizada al reintentar el mismo monto tras un fallo y renovada con otro monto o tras
      un éxito (HU-05).
- [x] Aviso tras registrar: «Simulación académica: no se ha realizado ningún cobro» (CA-06.4).
- [x] Historial propio con nombre del proyecto, fecha, importe y estado (HU-07, CA-07.1).
- [ ] Probar el flujo de donación en la SPA contra el stage con `donante1`.

## Fase 5 — Simulación, concurrencia, MFA y publicación del frontend (día 5)

Código, plantilla, OpenAPI, Postman y procedimientos listos (202 pruebas de backend, 71 de
frontend). Falta desplegar, publicar la SPA y reunir la evidencia de T08, T13 y T14 en AWS.

### Backend

- [x] HU-06: `POST /v1/donations/{donationId}/simulate`: DONANTE propietario, con
      `{ outcome: CONFIRMADA_SIMULADA | RECHAZADA_SIMULADA }`. Solo existe en el stage
      `academic` mediante `Condition: IsAcademicStage` (función, rol y log group); con
      `StageName=prod` la ruta no existe, y el handler responde 404 fuera de `academic` (CA-06.1).
- [x] Un `TransactWriteItems` actualiza la donación con la condición
      `status = PENDIENTE_SIMULACION AND donorSub = :sub`; si se confirma, la misma transacción
      hace `ADD confirmedAmountCents` en el proyecto y guarda el evento `DONATION_SIMULATE`
      (CA-06.2, CA-NF04.2).
- [x] Una transición inválida o repetida → 409. Un rechazo no suma al acumulado (CA-06.2,
      CA-06.3).
- [x] Documentado en `backend/README.md` por qué se eligió `TransactWriteItems` condicionado
      (CA-NF04.2).
- [ ] Desplegar y ejecutar en Postman «HU-06 — Confirmar» y «Simular otra vez → 409».

### Identidad

- [x] MFA obligatorio para GESTOR y AUDITOR con el trigger _pre token generation_: sin TOTP
      activo, Cognito no emite tokens; también corre al renovar, así que desactivar el MFA corta
      la sesión (CA-11.1, CA-11.2, decisión D5).
- [x] Alta de MFA con `npm run setup:mfa` (app client sin OAuth y tokens de 5 min) antes de
      asignar el grupo; procedimiento en `docs/pruebas-manuales.md`.
- [x] `gestor1` dado de alta con MFA (2026-11-14): sin grupo, `setup:mfa`, verificado
      `SOFTWARE_TOKEN_MFA` y grupo GESTOR reasignado.
- [ ] Dar de alta con MFA a un AUDITOR de prueba.
- [ ] Demostrar que revocar el refresh token impide renovar la sesión, mientras que el access
      token emitido sigue valiendo hasta expirar (CA-03.3, CA-03.4). Procedimiento en
      `docs/pruebas-manuales.md`.

### Pruebas de la fase

- [x] T08 automatizada: 10 confirmaciones concurrentes → un solo 200 y un solo incremento. Una
      prueba de mutación confirmó que falla sin la condición de estado (CA-06.2, CA-NF04.1).
- [ ] T08 contra el stage con `npm run evidence:t08` y guardar la salida en `evidence/T08/`.
- [ ] T13: token revocado usado antes de expirar → aceptado; después de expirar → rechazado
      (CA-03.4).
- [x] T14 automatizada: el trigger rechaza a GESTOR y AUDITOR sin TOTP (y sin aceptar SMS).
- [ ] T14 contra el stage: un GESTOR sin segundo factor no obtiene tokens. Guardar la captura
      (CA-11.2).

### Frontend y publicación

- [x] Simulación en «Mi cuenta»: botones «Simular confirmación» y «Simular rechazo» en las
      donaciones pendientes, con el texto exacto «Simulación académica: no se ha realizado
      ningún cobro» (CA-06.4).
- [x] Aviso de prototipo académico en el pie de página: un despliegue real exigiría una
      evaluación legal según la Ley N.º 29733 (CA-NF10.2).
- [x] S3 privado (bloqueo público, cifrado, solo TLS) y CloudFront con OAC, solo HTTPS
      (CA-NF01.1). La URL de la SPA se registra sola en Cognito y en el CORS del API.
- [x] Response headers policy de CloudFront con CSP restrictiva (sin `unsafe-inline`), HSTS,
      `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options` (CA-NF11.2). La barra de
      avance pasó a `<progress>` para no necesitar estilos en línea; la CSP se probó en local
      sin violaciones.
- [x] SPA publicada en CloudFront (2026-11-14): `/` y las rutas internas responden 200, HTTP
      redirige a HTTPS (301), el bucket no es accesible directamente (403) y las cabeceras de
      seguridad están presentes.

## Fase 6 — Endurecimiento y evidencias (día 6)

Revisión del stage `academic` desplegado con scripts de solo lectura (`npm run evidence:*`) y
pruebas automáticas nuevas: 310 de backend y 86 de frontend. Falta solo la medición de
rendimiento, que necesita cargar 50 proyectos en la tabla compartida.

- [x] T10 con IAM Policy Simulator: el rol de la función de listado solo puede hacer `Query`
      sobre el GSI; `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `Scan` y otras
      tablas → `implicitDeny`. La matriz de escrituras por rol coincide con el diseño
      (`evidence/T10/iam-report.md`). Prueba controlada: un `AccessDeniedException` responde
      500 genérico sin ARN ni cuenta, y el log guarda solo `errorName` (CA-NF03.1).
      `SimulatePrincipalPolicy` no sirve en esta cuenta: también evalúa las SCP de la
      organización de AWS, que no puede leer, y responde `explicitDeny` a todo; se usa
      `SimulateCustomPolicy` con las políticas reales de cada rol.
- [x] IAM Access Analyzer (`ValidatePolicy`) sobre las 33 políticas en línea: **0 hallazgos**.
      Ningún rol tiene políticas administradas. Comodines solo en los log streams del propio
      log group y en `userpool/*` del trigger (justificado, decisión D5) (CA-NF03.2).
- [x] Sin credenciales AWS persistentes: búsqueda de `AKIA…` y `aws_secret_access_key` en el
      repo sin coincidencias, `.env` ignorado y el CI no usa credenciales ni despliega, así que
      no necesita OIDC (CA-NF03.2).
- [x] Logs revisados con CloudWatch Logs Insights en los 13 log groups (14 días): **0
      coincidencias** de JWT, `Bearer`, correos o contraseñas. Prueba automática: ninguna ruta
      escribe el token, el correo, el `sub` ni el cuerpo, y cada línea tiene `requestId`,
      acción, resultado, código y duración (CA-NF01.2, CA-NF07.1).
- [x] CloudWatch: caso exitoso (200) y rechazado (401/403) en los access logs y `denied` en el
      log JSON de Lambda, con el resumen por ruta y estado (`evidence/observability/report.md`)
      (CA-NF07.2).
- [x] CloudTrail registra cada `CreateChangeSet` y `ExecuteChangeSet` del stack (CA-NF07.2).
- [x] Rendimiento con 54 proyectos publicados (2026-11-12): p95 de 199 ms en el catálogo, 152 ms
      en el detalle y 147 ms en las estadísticas, sin errores; el límite es 1500 ms. Medido
      desde Perú con 5 solicitudes de calentamiento y 100 medidas por ruta; los 50 proyectos de
      carga se borraron después (`evidence/performance/report.md`) (CA-NF05.1, CA-NF05.2).
- [x] CORS de la SPA publicada: SAM no transformaba el `Fn::Split`/`Fn::Join` de
      `CorsConfiguration` y el API seguía admitiendo solo `localhost` desde la fase 5, así que la
      SPA en CloudFront no cargaba datos. Ahora `AllowOrigins: !Ref AllowedOrigins` y la URL de
      CloudFront va en `samconfig.toml`; una prueba lo comprueba.
- [x] Accesibilidad WCAG 2.2 AA (CA-NF06.1, CA-NF06.2): axe-core en CI sobre 8 pantallas y en
      el navegador (con contraste y tamaño de objetivos) sin violaciones; revisión manual a
      375 px y con teclado. Se corrigieron el aviso fuera de región, el foco visible y los
      títulos por página (`docs/accesibilidad.md`).
- [x] La UI no autoriza: prueba que llama a cada ruta protegida con tokens de los cuatro roles
      (todos con todos los scopes) y solo el rol correcto pasa; enviar `status`,
      `confirmedAmountCents`, `donorSub` o `groups` en el cuerpo → 400 (CA-NF02.2).
- [x] Revisión de Codex del PR de la fase 4: una clave de idempotencia vencida que el TTL aún no
      borró ahora cuenta como nueva (`attribute_not_exists(pk) OR expiresAt <= :now`).

## Fase 7 — Extensiones (opcional, solo con el MVP completo)

- [x] HU-10: `GET /v1/audit` solo para AUDITOR (`api/audit.read` + grupo), con filtros por tipo
      y por fecha o instante, paginación por tipo con un cursor validado y 400 sin repetir los
      valores recibidos. Función con solo `dynamodb:Query` sobre AuditEvents. El MFA lo
      garantiza el trigger de la fase 5. Pantalla «Auditoría» en la SPA (CA-10.1, CA-10.2).
- [x] HU-12: reglas de HU-04, HU-07 y HU-08 en Cedar (`policies/`, 3 políticas y esquema
      validados en modo estricto) y Policy Decision Point intercambiable: `embedded` o
      `verified-permissions` (`IsAuthorized` desde Lambda). La plantilla crea el policy store y
      sus políticas (copia exacta de `policies/`, comprobada por prueba) y solo da
      `verifiedpermissions:IsAuthorized` sobre ese store cuando
      `AuthorizationEngine=verified-permissions` (CA-12.1).
- [x] HU-12: T03, T09 y T12 pasan igual con los dos motores: la misma matriz de 15 decisiones y
      las pruebas de handlers se ejecutan con el PDP embebido y con el motor oficial de Cedar
      (WebAssembly) sobre las políticas reales. Si Verified Permissions falla, el API responde
      500: nunca permite por defecto (CA-12.2).
- [ ] Desplegar con `AuthorizationEngine=verified-permissions` y repetir T03, T09 y T12 en
      Postman para la evidencia en AWS; la comparación embebida frente a externalizada va en el
      informe (fase 8).

## Fase 8 — Cierre, entrega y limpieza (día 7)

- [ ] README raíz con la arquitectura, el despliegue, la limpieza (`sam delete`) y las
      restricciones de la cuenta (CA-NF08.2).
- [ ] Informe técnico:
  - [ ] Tabla de mapeo a los 7 principios NIST SP 800-207 y a PE/PA/PEP (CA-NF02.3).
  - [ ] Limitaciones: revocación, postura del dispositivo, WAF con HTTP API y cuenta compartida
        (design.md §6.3).
  - [ ] Justificación de los tokens en memoria (CA-NF11.1).
- [ ] Trazabilidad: cada HU, CA y RNF-HU aparece en al menos un test y en el informe
      (requirements.md §7).
- [ ] Evidencias sanitizadas de T01–T14 en `evidence/`.
- [ ] `AI_USAGE.md` completo (design.md §10).
- [ ] URL de la demo HTTPS activa durante la evaluación y demo con usuarios de los cuatro roles.
- [ ] Limpieza al terminar la evaluación: `sam delete`, vaciar y borrar los buckets, borrar el
      user pool si sigue existiendo y comprobar en Resource Explorer que no quedan recursos,
      también en `us-east-1` para CloudWatch Logs y WAF (CA-NF09.2).
- [ ] Borrar el user pool y el app client de la demo Java (`us-east-2_yAC3TdllN`) cuando el pool
      nuevo funcione.

---

## Matriz de pruebas T01–T14

| ID  | Escenario                                 | Esperado                           | Fase | Automática | Evidencia AWS |
| --- | ----------------------------------------- | ---------------------------------- | ---- | ---------- | ------------- |
| T01 | Visitante consulta proyectos              | 200, sin borradores                | 3    | ✅         | ✅            |
| T02 | Sin token intenta donar                   | 401                                | 2    | ✅         | ✅            |
| T03 | Donante intenta crear proyecto            | 403                                | 3    | ✅         | ✅            |
| T04 | Donante envía 0, 100001 o valor no entero | 400                                | 4    | ✅         | ⬜            |
| T05 | Donante crea intención válida             | 201, pendiente, sin cargo          | 4    | ✅         | ⬜            |
| T06 | Repite clave y payload idénticos          | Mismo resultado, una sola donación | 4    | ✅         | ⬜            |
| T07 | Repite clave con payload distinto         | 409                                | 4    | ✅         | ⬜            |
| T08 | 10 confirmaciones concurrentes            | Un solo incremento                 | 5    | ✅         | ⬜            |
| T09 | Donante consulta donación ajena           | 403/404 sin filtración             | 4    | ✅         | ⬜            |
| T10 | Lambda de listado intenta escribir        | `AccessDenied` y error controlado  | 6    | ✅         | ✅            |
| T11 | ID token o token alterado como Bearer     | 401                                | 2    | —          | ⬜            |
| T12 | Gestor consulta historial de un donante   | 403/404                            | 4    | ✅         | ✅            |
| T13 | Token revocado usado antes de expirar     | Aceptado hasta expirar; luego 401  | 5    | —          | ⬜            |
| T14 | GESTOR inicia sesión sin segundo factor   | No obtiene tokens                  | 5    | ✅         | ⬜            |

«—» indica que la prueba depende de API Gateway, IAM o Cognito y solo se puede demostrar contra
AWS.

## Decisiones abiertas

Conviene acordarlas con el docente antes de la fase indicada.

- **D1 (fase 4) — Decidida el 2026-11-13:** T09 pide consultar una donación ajena, pero
  `GET /v1/donations/me` no recibe un ID. Se añadió `GET /v1/donations/{donationId}` (DONANTE
  propietario, `api/donations.read`); una donación ajena responde 404, igual que una
  inexistente, para no revelar que existe. Documentado en OpenAPI.
- **D2 (fase 3) — Decidida el 2026-11-12:** la matriz de roles dice «crear/editar/publicar»,
  pero design.md §4 no lista un endpoint de edición. Se añade `PATCH /v1/projects/{projectId}`
  (GESTOR, `api/projects.write`):
  - Se puede editar en cualquier estado: título, descripción y `goalAmountCents`. Así se
    corrige una campaña publicada con datos erróneos sin ocultarla a quienes ya donaron.
  - La meta nunca queda por debajo de `confirmedAmountCents` (409); la condición se evalúa en
    la misma escritura de DynamoDB, a salvo de una confirmación simultánea.
  - `confirmedAmountCents`, `status`, `currency` y `projectId` no se editan por esta ruta.
  - No se puede despublicar: el modelo solo tiene BORRADOR → PUBLICADO, y ocultar una campaña
    con donaciones pendientes las dejaría sin poder confirmarse.
  - Cada edición genera un `AuditEvent` con los campos cambiados (parte 2 de la fase 3).
  - Una campaña que no debería existir necesitaría un estado «Cerrada»: posible extensión,
    fuera del MVP.
- **D3 (fase 0):** CA-NF03.3 pide usuarios IAM con MFA, pero la cuenta usa la nueva experiencia
  de AWS, donde los integrantes se invitan como _team members_ desde AWS Settings. Hay que
  acordar cómo se acredita.
- **D4 (fase 2):** CA-03.2 y T11 piden 401 para un ID token, pero el JWT authorizer de HTTP API
  acepta su firma y su `aud` (es el `client_id`) y lo rechaza por no tener scopes: responde
  **403**. La Lambda además lo rechaza con 401 (`token_use`), aunque no llega a ejecutarse. El
  servidor local imita los 403. Opciones: aceptar 403 como «rechazado» y documentarlo, o
  quitar los scopes del authorizer y validarlos solo en Lambda (contradice design.md §4).
  Confirmar con el docente tras medir el código real en el stage desplegado.
- **D5 (fase 5) — Decidida el 2026-11-14:** Cognito solo permite MFA obligatorio para todo
  el pool, y ya no se puede activar en un pool existente. Se mantiene el MFA opcional (TOTP)
  y un trigger _pre token generation_ rechaza la emisión de tokens a GESTOR y AUDITOR sin
  TOTP activo. El alta se hace con `npm run setup:mfa` antes de asignar el grupo. Limitación:
  el rol del trigger usa `userpool/*` (solo `AdminGetUser`) para evitar la dependencia
  circular con el pool.
- **D6:** confirmar con el docente la fecha de entrega. El plan es de una semana desde el
  2026-11-02.
