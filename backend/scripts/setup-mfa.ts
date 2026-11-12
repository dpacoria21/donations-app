/**
 * Alta de MFA TOTP para una cuenta que va a ser GESTOR o AUDITOR (HU-11, decisión D5).
 * Lo ejecuta la propia persona, ANTES de que el administrador le asigne el grupo:
 *
 *   npm run setup:mfa
 *
 * Pide correo y contraseña (y una nueva si la temporal lo exige), muestra la clave para la app
 * autenticadora (Google Authenticator, Microsoft Authenticator, Authy…), verifica un código y
 * activa TOTP como método preferido. Usa el app client de configuración (salida
 * `MfaSetupClientId`, variable COGNITO_MFA_SETUP_CLIENT_ID); no necesita credenciales de AWS.
 *
 * Aviso: la terminal muestra lo que se escribe. Ejecutarlo en un equipo propio, sin
 * compartir pantalla, y no guardar las contraseñas en ningún archivo.
 */
import {
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import { createInterface } from 'node:readline/promises';

const clientId = process.env.COGNITO_MFA_SETUP_CLIENT_ID?.trim();
if (!clientId) {
  console.error('Define COGNITO_MFA_SETUP_CLIENT_ID (salida MfaSetupClientId de la pila).');
  process.exit(1);
}

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? 'us-east-2',
});
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (question: string) => (await terminal.question(question)).trim();

try {
  const username = await ask('Correo de la cuenta: ');
  let response = await cognito.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD: await ask('Contraseña: ') },
    }),
  );

  if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    console.log('La contraseña es temporal: elige una nueva (12+ caracteres, mayúscula, número).');
    response = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId,
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: response.Session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: await ask('Nueva contraseña: '),
        },
      }),
    );
  }
  if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
    // La cuenta ya tenía TOTP: se confirma con el código actual y se puede re-registrar.
    response = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId,
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: response.Session,
        ChallengeResponses: {
          USERNAME: username,
          SOFTWARE_TOKEN_MFA_CODE: await ask('Código actual de tu app autenticadora: '),
        },
      }),
    );
  }

  const auth: AuthenticationResultType | undefined = response.AuthenticationResult;
  if (!auth?.AccessToken) {
    throw new Error(`Desafío no soportado: ${String(response.ChallengeName)}`);
  }

  const { SecretCode } = await cognito.send(
    new AssociateSoftwareTokenCommand({ AccessToken: auth.AccessToken }),
  );
  if (!SecretCode) throw new Error('Cognito no devolvió la clave TOTP');

  const issuer = 'AQP-SOLIDARIA';
  console.log('\nAgrega una cuenta en tu app autenticadora con esta clave de configuración:');
  console.log(`\n  ${SecretCode}\n`);
  console.log('O, si tu app acepta enlaces otpauth (por ejemplo, con un generador de QR local):');
  console.log(
    `  otpauth://totp/${issuer}:${encodeURIComponent(username)}?secret=${SecretCode}&issuer=${issuer}\n`,
  );

  const verification = await cognito.send(
    new VerifySoftwareTokenCommand({
      AccessToken: auth.AccessToken,
      UserCode: await ask('Código de 6 dígitos que muestra la app: '),
      FriendlyDeviceName: 'app-autenticadora',
    }),
  );
  if (verification.Status !== 'SUCCESS') throw new Error('El código no es válido');

  await cognito.send(
    new SetUserMFAPreferenceCommand({
      AccessToken: auth.AccessToken,
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    }),
  );
  console.log('\nMFA TOTP activado. Desde ahora cada inicio de sesión pedirá el código.');
  console.log('Avisa al administrador para que te asigne el grupo.');
} catch (error) {
  console.error(`\nNo se pudo activar el MFA: ${error instanceof Error ? error.message : 'error'}`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
