import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Los handlers escriben un log JSON por solicitud; solo se muestran si una prueba falla.
    silent: 'passed-only',
  },
});
