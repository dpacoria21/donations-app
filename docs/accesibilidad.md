# Revisión de accesibilidad (RNF-HU-06)

Revisión de la SPA frente a WCAG 2.2 nivel AA (CA-NF06.1, CA-NF06.2), hecha el 2026-11-12 en
la fase 6.

## Método

1. **Automática en CI** ([frontend/src/a11y.test.tsx](../frontend/src/a11y.test.tsx)): axe-core
   4.14 con las reglas `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` y
   `best-practice` sobre el catálogo, el detalle con el formulario de donación (también con
   errores de validación), la confirmación de la intención, «Mi cuenta» con simulación, la
   gestión, el formulario de proyecto, la auditoría y la página 404. jsdom no calcula estilos,
   así que ahí se desactivan las reglas de contraste y de tamaño de los objetivos.
2. **axe-core en el navegador** (Chromium, servidor de desarrollo contra el stage `academic`):
   las mismas reglas, **incluidos el contraste y el tamaño de los objetivos**, en `/`,
   `/proyectos/:id`, `/cuenta`, `/gestion`, `/auditoria` y una ruta inexistente. Resultado:
   **0 violaciones** en todas.
3. **Manual a 375 × 812 px y con teclado**: reflujo, orden del foco, foco visible y el enlace
   «Saltar al contenido».

## Resultados por criterio

| Criterio WCAG 2.2                         | Cómo se cumple                                                                                      | Verificación                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1.1.1 Contenido no textual                | Sin imágenes con información; la barra de avance es `<progress>` con su texto                       | axe                                               |
| 1.3.1 Información y relaciones            | Encabezados en orden, listas, `<dl>`, etiquetas `<label for>`, todo el contenido dentro de regiones | axe (detectó el aviso fuera de región; corregido) |
| 1.3.5 Propósito de los campos             | El único dato personal (correo) lo pide el managed login de Cognito                                 | Revisión                                          |
| 1.4.3 Contraste mínimo                    | Texto `slate-600` o más oscuro sobre blanco; botones `sky-700`/`emerald-700` con texto blanco       | axe en el navegador                               |
| 1.4.10 Reflujo                            | Sin desplazamiento horizontal a 375 px (`scrollWidth = clientWidth = 375`)                          | Manual                                            |
| 1.4.11 Contraste de componentes           | Bordes de campos `slate-300` con foco `sky-700` de 3 px                                             | axe en el navegador + manual                      |
| 2.1.1 Teclado                             | Todo es `<a>`, `<button>`, `<input>` o `<select>` nativo                                            | Manual                                            |
| 2.4.1 Evitar bloques                      | «Saltar al contenido» visible al recibir el foco; lleva a `<main id="contenido">`                   | Manual                                            |
| 2.4.2 Título de la página                 | Título propio en cada página (`PageTitle`, React 19 lo lleva al `<head>`)                           | Prueba automática + manual                        |
| 2.4.3 Orden del foco                      | Orden del DOM: salto, logo, navegación, sesión, contenido                                           | Manual                                            |
| 2.4.7 y 2.4.13 Foco visible / apariencia  | Regla global `:focus-visible` de 3 px `sky-700` con separación de 2 px                              | Manual                                            |
| 2.5.8 Tamaño del objetivo                 | Botones y enlaces de al menos 24 × 24 px                                                            | axe en el navegador                               |
| 3.1.1 Idioma de la página                 | `<html lang="es">`                                                                                  | axe                                               |
| 3.3.1 y 3.3.3 Identificación y sugerencia | Errores bajo el campo, asociados con `aria-describedby` y `aria-invalid`; el foco va al primero     | axe con errores visibles + pruebas                |
| 3.3.2 Etiquetas o instrucciones           | Cada campo tiene etiqueta y ayuda (por ejemplo, el rango del monto)                                 | axe                                               |
| 4.1.3 Mensajes de estado                  | Cargas y confirmaciones con `role="status"`; errores con `role="alert"`                             | Pruebas de interfaz                               |

## Cambios hechos en esta revisión

- El aviso «Prototipo académico» quedaba fuera de cualquier región: pasó al `<header>`.
- Foco visible uniforme para cualquier control (`frontend/src/index.css`); antes algunos
  botones (simular, publicar, editar) dependían del estilo por defecto del navegador.
- Título de pestaña por página (antes todas compartían el mismo).

## Limitaciones

- No se probó con lectores de pantalla reales (NVDA o VoiceOver); solo con axe y revisión del
  árbol de accesibilidad.
- El managed login de Cognito (formulario de usuario, contraseña y TOTP) lo controla AWS y no se
  evaluó.
