import { createDevServer } from './app.ts';

const port = Number(process.env.PORT ?? '3000');
const host = '127.0.0.1';

createDevServer().listen(port, host, () => {
  console.log(`Servidor local de desarrollo: http://${host}:${String(port)}/`);
});
