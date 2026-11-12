/**
 * Título de la pestaña por página (WCAG 2.4.2): React 19 lo mueve al `<head>`. Así un lector de
 * pantalla anuncia en qué página se está tras cada navegación.
 */
export function PageTitle({ children }: { children: string }) {
  return <title>{`${children} · Fundación AQP-SOLIDARIA`}</title>;
}
