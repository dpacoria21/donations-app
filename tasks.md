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
| 2    | Infraestructura base y autenticación     | Pendiente |
| 3    | Proyectos y catálogo                     | En curso  |
| 4    | Donaciones e idempotencia                | Pendiente |
| 5    | Simulación, concurrencia, MFA y frontend | Pendiente |
| 6    | Endurecimiento y evidencias              | Pendiente |
| 7    | Extensiones (opcional)                   | Pendiente |
| 8    | Cierre, entrega y limpieza               | Pendiente |

¹ Falta solo invitar al resto del equipo a la cuenta AWS con MFA, cuando se sumen (D3).

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
- [ ] Llevar los tres endpoints a DynamoDB y desplegarlos.
- [ ] `POST /v1/projects`: GESTOR con el scope `api/projects.write`. Valida título, descripción
      y `goalAmountCents` entero positivo, crea en BORRADOR y responde 201/400/401/403 (CA-08.1,
      CA-04.1).
- [ ] `PATCH /v1/projects/{projectId}/publish`: solo GESTOR. Publicar uno ya publicado → 409;
      inexistente → 404 (CA-08.2).
- [ ] Edición de proyectos. Ver la decisión D2.
- [ ] Módulo `audit`: cada creación o publicación registra un `AuditEvent` con actor
      seudonimizado, fecha, acción y resultado, sin tokens ni datos financieros (CA-08.3,
      CA-10.2).

### Pruebas de la fase

- [x] T01 unitaria: el visitante ve 200 y ningún borrador (CA-01.1, CA-01.2).
- [ ] T01 contra el stage desplegado.
- [ ] T03: un donante intenta crear un proyecto → 403 (CA-04.1).

### Frontend

- [ ] Catálogo con nombre, finalidad, meta y suma confirmada en formato PEN, y un estado vacío
      comprensible (HU-01, CA-09.1).
- [ ] Detalle con identificador, descripción, objetivo, estado y monto acumulado, y una página
      404 (HU-02).
- [ ] Pantallas del GESTOR para crear y publicar proyectos (HU-08).

## Fase 4 — Donaciones e idempotencia (día 4)

### Backend

- [ ] Esquema Zod: `projectId` UUID y `amountCents` entero entre 100 y 100000. La cabecera
      `Idempotency-Key` es obligatoria y debe ser un UUID (CA-05.1, CA-05.2).
- [ ] `POST /v1/donations`: DONANTE con el scope `api/donations.write`. El `donorSub` sale del
      token, nunca del body (CA-05.3). Proyecto inexistente → 404; no PUBLICADO → 409; datos
      inválidos → 400. Ningún error modifica el acumulado (CA-05.2).
- [ ] Un solo `TransactWriteItems` que cree el `IdempotencyRecord` (condición
      `attribute_not_exists`) y la donación `PENDIENTE_SIMULACION` (AD-05, CA-05.4).
- [ ] Repetir la misma clave con el mismo `payloadHash` (SHA-256 del body normalizado) devuelve
      la respuesta guardada; con un hash distinto, 409. `TransactionCanceledException` → 409
      sin efectos parciales (CA-05.4, design.md §5).
- [ ] No pedir ni almacenar tarjeta, CVV, cuenta bancaria, DNI ni otros datos de pago (CA-05.5).
- [ ] `GET /v1/donations/me`: solo los registros del `sub` autenticado, con fecha, importe,
      proyecto y estado (CA-07.1). Un GESTOR recibe 403 (CA-04.2).
- [ ] Endpoint para consultar una donación por ID, con 404 si es ajena. Ver la decisión D1
      (CA-07.2).

### Pruebas de la fase

- [ ] T04: montos 0, 100001 o no enteros → 400 (CA-05.2).
- [ ] T05: intención válida → 201, estado pendiente y sin cargo (CA-05.1).
- [ ] T06: misma clave y mismo payload → el mismo resultado y una sola donación (CA-05.4).
- [ ] T07: misma clave con un payload distinto → 409 (CA-05.4).
- [ ] T09: un donante consulta una donación ajena → 403/404 sin filtrar datos (CA-07.2).
- [ ] T12: un gestor consulta el historial de un donante → 403/404 (CA-04.2).

### Frontend

- [ ] Formulario de donación con importe en PEN, etiquetas y errores accesibles. Generar una
      `Idempotency-Key` por intención y reutilizarla en los reintentos (HU-05).
- [ ] Historial propio (HU-07).

## Fase 5 — Simulación, concurrencia, MFA y publicación del frontend (día 5)

### Backend

- [ ] HU-06: `POST /v1/donations/{donationId}/simulate`: DONANTE propietario. Solo existe en el stage
      `academic` mediante una `Condition` de SAM; en otro stage la ruta no existe (CA-06.1).
- [ ] Un `TransactWriteItems` actualiza la donación con la condición
      `status = PENDIENTE_SIMULACION AND donorSub = :sub`. Si se confirma, la misma transacción
      incrementa `confirmedAmountCents` (CA-06.2, CA-NF04.2).
- [ ] Una transición inválida o repetida → 409. Un rechazo no suma al acumulado (CA-06.2,
      CA-06.3).
- [ ] Documentar por qué se eligió `TransactWriteItems` condicionado (CA-NF04.2).

### Identidad

- [ ] Activar TOTP en las cuentas de prueba de GESTOR y AUDITOR antes de asignarles el grupo, y
      comprobar que no pueden desactivarlo (CA-11.1). Ver la decisión D5.
- [ ] Demostrar que revocar el refresh token impide renovar la sesión, mientras que el access
      token emitido sigue valiendo hasta expirar (CA-03.3, CA-03.4).

### Pruebas de la fase

- [ ] T08: 10 confirmaciones concurrentes de la misma donación → un solo incremento (CA-06.2,
      CA-NF04.1).
- [ ] T13: token revocado usado antes de expirar → aceptado; después de expirar → rechazado
      (CA-03.4).
- [ ] T14: un GESTOR sin segundo factor no obtiene tokens. Guardar la captura (CA-11.2).

### Frontend y publicación

- [ ] Pantalla de simulación con el texto exacto «Simulación académica: no se ha realizado
      ningún cobro» (CA-06.4).
- [ ] Aviso de prototipo académico: un despliegue real exigiría una evaluación legal según la
      Ley N.º 29733 (CA-NF10.2).
- [ ] S3 privado y CloudFront con OAC, solo HTTPS (CA-NF01.1).
- [ ] Response headers policy de CloudFront con CSP restrictiva, HSTS,
      `X-Content-Type-Options` y `Referrer-Policy` (CA-NF11.2).

## Fase 6 — Endurecimiento y evidencias (día 6)

- [ ] T10: comprobar con IAM Policy Simulator o una prueba controlada que la Lambda de listado
      no puede escribir en DynamoDB → `AccessDenied` y un error controlado (CA-NF03.1).
- [ ] Revisar las políticas con IAM Access Analyzer (CA-NF03.2).
- [ ] Ninguna credencial AWS persistente en el código ni en el CI. Si se despliega desde GitHub
      Actions, usar OIDC limitado al repositorio y a `main` (CA-NF03.2).
- [ ] Revisar los logs: sin tokens, secretos ni datos personales (CA-NF01.2).
- [ ] Capturas de CloudWatch con un caso exitoso y uno rechazado (401/403). Los 401 del
      authorizer se ven en los logs de acceso de la API (CA-NF07.2).
- [ ] CloudTrail muestra los cambios de infraestructura (CA-NF07.2).
- [ ] Rendimiento: con 50 proyectos, el p95 de los GET es de 1.5 s o menos, sin contar el cold
      start. Registrar el método, la herramienta y las condiciones (CA-NF05.1, CA-NF05.2).
- [ ] Accesibilidad: catálogo, detalle, donación y confirmación usables a 375 px y con teclado;
      etiquetas y foco visible; revisión WCAG 2.2 AA (CA-NF06.1, CA-NF06.2).
- [ ] Demostrar que la UI no es la que autoriza: llamar directamente al API con tokens de otros
      roles. Lambda valida rol, propietario y reglas de negocio en cada solicitud y no confía en
      roles, montos ni IDs enviados por el navegador (CA-NF02.2, design.md §9).

## Fase 7 — Extensiones (opcional, solo con el MVP completo)

- [ ] HU-10: `GET /v1/audit` solo para AUDITOR con MFA, con filtros por tipo y fecha
      (CA-10.1, CA-10.2).
- [ ] HU-12: expresar en Cedar (`policies/`) las reglas de HU-04, HU-07 y HU-08 y evaluarlas con
      Amazon Verified Permissions (`IsAuthorized`) desde Lambda (CA-12.1).
- [ ] HU-12: T03, T09 y T12 pasan igual con el motor externo; comparar la autorización embebida
      con la externalizada en el informe (CA-12.2).

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

| ID  | Escenario                                 | Esperado                           | Fase | Automática      | Evidencia AWS |
| --- | ----------------------------------------- | ---------------------------------- | ---- | --------------- | ------------- |
| T01 | Visitante consulta proyectos              | 200, sin borradores                | 3    | ✅ (en memoria) | ⬜            |
| T02 | Sin token intenta donar                   | 401                                | 2    | ⬜              | ⬜            |
| T03 | Donante intenta crear proyecto            | 403                                | 3    | ⬜              | ⬜            |
| T04 | Donante envía 0, 100001 o valor no entero | 400                                | 4    | ⬜              | ⬜            |
| T05 | Donante crea intención válida             | 201, pendiente, sin cargo          | 4    | ⬜              | ⬜            |
| T06 | Repite clave y payload idénticos          | Mismo resultado, una sola donación | 4    | ⬜              | ⬜            |
| T07 | Repite clave con payload distinto         | 409                                | 4    | ⬜              | ⬜            |
| T08 | 10 confirmaciones concurrentes            | Un solo incremento                 | 5    | ⬜              | ⬜            |
| T09 | Donante consulta donación ajena           | 403/404 sin filtración             | 4    | ⬜              | ⬜            |
| T10 | Lambda de listado intenta escribir        | `AccessDenied` y error controlado  | 6    | —               | ⬜            |
| T11 | ID token o token alterado como Bearer     | 401                                | 2    | —               | ⬜            |
| T12 | Gestor consulta historial de un donante   | 403/404                            | 4    | ⬜              | ⬜            |
| T13 | Token revocado usado antes de expirar     | Aceptado hasta expirar; luego 401  | 5    | —               | ⬜            |
| T14 | GESTOR inicia sesión sin segundo factor   | No obtiene tokens                  | 5    | —               | ⬜            |

«—» indica que la prueba depende de API Gateway, IAM o Cognito y solo se puede demostrar contra
AWS.

## Decisiones abiertas

Conviene acordarlas con el docente antes de la fase indicada.

- **D1 (fase 4):** T09 pide consultar una donación ajena, pero `GET /v1/donations/me` no
  recibe un ID. Propuesta: añadir `GET /v1/donations/{donationId}` (DONANTE propietario; 404 si
  es ajena) y documentarlo en OpenAPI.
- **D2 (fase 3):** la matriz de roles dice «crear/editar/publicar», pero los endpoints no
  incluyen la edición. Hay que decidir si se añade `PATCH /v1/projects/{projectId}` (solo en
  BORRADOR) o si la edición queda fuera.
- **D3 (fase 0):** CA-NF03.3 pide usuarios IAM con MFA, pero la cuenta usa la nueva experiencia
  de AWS, donde los integrantes se invitan como _team members_ desde AWS Settings. Hay que
  acordar cómo se acredita.
- **D4 (fase 2):** CA-03.2 y T11 piden 401 para un ID token, pero el JWT authorizer de HTTP API
  acepta su firma y su `aud` (es el `client_id`) y lo rechaza por no tener scopes: responde
  **403**. La Lambda además lo rechaza con 401 (`token_use`), aunque no llega a ejecutarse. El
  servidor local imita los 403. Opciones: aceptar 403 como «rechazado» y documentarlo, o
  quitar los scopes del authorizer y validarlos solo en Lambda (contradice design.md §4).
  Confirmar con el docente tras medir el código real en el stage desplegado.
- **D5 (fase 5):** en Cognito, el MFA obligatorio se configura para todo el pool, no por grupo.
  Con el MFA opcional, hay que garantizar el TOTP en GESTOR y AUDITOR por procedimiento de alta
  y demostrarlo en T14.
- **D6:** confirmar con el docente la fecha de entrega. El plan es de una semana desde el
  2026-11-02.
