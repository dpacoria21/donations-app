import { createDevServer } from './app.ts';

// Variables de `.env` (cargado con --env-file-if-exists); ver `.env.template`.
const port = Number(process.env.PORT ?? '3000');
const host = '127.0.0.1';
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

createDevServer({ allowedOrigins }).listen(port, host, () => {
  console.log(`API local de desarrollo: http://${host}:${String(port)}/v1/projects`);
  console.log(`CORS permitido para: ${allowedOrigins.join(', ') || '(ninguno)'}`);
});
