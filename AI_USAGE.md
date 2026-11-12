# Declaración de uso de IA

Declaración obligatoria de design.md §10. Se añade una fila por cada PR con aportes de un
asistente de IA. La misma tabla se copia en el informe técnico.

## Reglas que sigue el equipo

- Todo cambio generado por IA entra por PR y lo revisa un integrante distinto de quien lo
  generó.
- No se comparten con los asistentes credenciales AWS, tokens, el contenido de `.env` ni datos
  personales reales.
- Los agentes con acceso a terminal **no** despliegan ni ejecutan comandos sobre la cuenta AWS
  sin supervisión. Las consultas de solo lectura se hacen con la sesión del integrante presente.
- Los controles de seguridad (authz, idempotencia, políticas IAM) tienen pruebas escritas o
  revisadas por el equipo. No se aceptan políticas IAM con comodines sugeridas por IA sin
  justificación.
- Cada integrante debe poder explicar el código y las decisiones en la sustentación.

## Registro

| Herramienta / modelo          | Participantes | Tareas asistidas                                                                     | Aportes IA                                                                                                                                    | Validación humana                                                      | Limitaciones                                                                                                     |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Claude Code (Claude Opus 5.5) | Diego Pacori  | Análisis de requirements.md y design.md; reestructuración del repositorio (fase 1)   | Eliminación del código Java/Spring que no seguía el diseño; esqueletos de `backend/` y `frontend/`; `tasks.md` (commits `3f6c850`, `5d0e50a`) | Revisión del integrante que la usó; `npm run check` en ambos proyectos | Elección de TypeScript 6.0 en lugar de 7.0 por compatibilidad con typescript-eslint                              |
| Claude Code (Claude Opus 5.5) | Diego Pacori  | Fase 1: endpoints públicos de proyectos (HU-01, HU-02, HU-09), CI, OpenAPI y Postman | Handlers Lambda, módulo `authz`, logger JSON, servidor local, `ci.yml`, `dependabot.yml`, `docs/api.yaml` y pruebas Vitest (PR #1)            | 34 pruebas de backend y 3 de frontend en verde; CI en verde en el PR   | La colección de Postman no se ejecutó con Newman; los endpoints usan datos en memoria hasta la fase 2            |
| Claude Code (Claude Opus 5.5) | Diego Pacori  | Fase 0: modelo de amenazas, esta declaración y guía de configuración de la cuenta    | `docs/threat-model.md`, `AI_USAGE.md`, `docs/cuenta-aws.md` y actualización de `tasks.md` (PR pendiente)                                      | Pendiente: revisión por otro integrante en el PR                       | El asistente no tuvo acceso a la cuenta AWS (sesión caducada); el estado de la cuenta debe confirmarlo el equipo |

## Cómo añadir una fila

1. **Herramienta / modelo:** nombre y versión si se conoce.
2. **Participantes:** quién la usó.
3. **Tareas asistidas:** historias (HU/CA) o módulos, y la etapa (análisis, código, pruebas,
   documentación).
4. **Aportes IA:** qué generó o modificó, con el enlace al PR.
5. **Validación humana:** quién revisó, qué pruebas se ejecutaron y qué se corrigió.
6. **Limitaciones:** errores detectados, riesgos o resultados que no se pudieron verificar.
