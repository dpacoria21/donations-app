import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createDevServer, type TokenVerifier } from './app.ts';

// Variables de `.env` (cargado con --env-file-if-exists); ver `.env.template`.
const port = Number(process.env.PORT ?? '3000');
const host = '127.0.0.1';
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
const clientId = process.env.COGNITO_CLIENT_ID?.trim();

/**
 * Misma verificación que el JWT authorizer: firma con las llaves públicas (JWKS) del user
 * pool, emisor, expiración y `client_id` (access token) o `aud` (ID token). Se aceptan ambos
 * tipos para que, como en AWS, un ID token falle por falta de scope (decisión D4).
 */
let verifyToken: TokenVerifier | undefined;
if (userPoolId && clientId) {
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: null });
  verifyToken = async (token) => await verifier.verify(token);
}

createDevServer({ allowedOrigins, verifyToken }).listen(port, host, () => {
  console.log(`API local de desarrollo: http://${host}:${String(port)}/v1/projects`);
  console.log(`CORS permitido para: ${allowedOrigins.join(', ') || '(ninguno)'}`);
  console.log(
    verifyToken
      ? `Rutas protegidas: tokens del user pool ${userPoolId ?? ''}`
      : 'Rutas protegidas: sin COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID, responden 401',
  );
});
