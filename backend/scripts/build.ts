/**
 * Empaqueta cada módulo de handlers en `dist/<módulo>/handlers.mjs` (ESM, Node 24) para que
 * `infra/template.yaml` lo despliegue. Las dependencias, incluido el AWS SDK, van dentro del
 * paquete: así Lambda ejecuta las mismas versiones fijadas en package-lock.json.
 */
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

/** Un punto de entrada por módulo; cada función Lambda elige su export con `Handler`. */
const MODULES = ['projects'] as const;

await rm('dist', { recursive: true, force: true });

for (const name of MODULES) {
  await build({
    entryPoints: [`src/${name}/handlers.ts`],
    outfile: `dist/${name}/handlers.mjs`,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: true,
    minify: true,
    legalComments: 'none',
    // Algunas dependencias CommonJS del SDK usan `require`, que no existe en ESM.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'info',
  });
}
