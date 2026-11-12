import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { PageTitle } from '../components/PageTitle.tsx';

type Failure = 'mfa-required' | 'other';

/**
 * El trigger *pre token generation* rechaza a un GESTOR o AUDITOR sin TOTP con un error que
 * empieza por `MFA_REQUERIDO` (HU-11, T14), y Cognito lo devuelve en `error_description`. Solo
 * se usa para elegir un mensaje fijo: el texto de la URL nunca se muestra, porque cualquiera
 * puede construir un enlace a esta página con otro texto.
 */
function classify(error: unknown): Failure {
  const description = (error as { error_description?: unknown } | null)?.error_description;
  const text = `${error instanceof Error ? error.message : ''} ${typeof description === 'string' ? description : ''}`;
  return text.includes('MFA_REQUERIDO') ? 'mfa-required' : 'other';
}

/** Destino de `redirect_uri`: canjea el código (con PKCE) por los tokens y vuelve a la app. */
export function CallbackPage() {
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    completeLogin()
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch((error: unknown) => {
        setFailure(classify(error));
      });
  }, [completeLogin, navigate]);

  if (failure) {
    return (
      <>
        <PageTitle>Error de inicio de sesión</PageTitle>
        <h1 className="text-2xl font-bold">No se pudo iniciar sesión</h1>
        <p role="alert" className="mt-2 text-red-800">
          {failure === 'mfa-required'
            ? 'Las cuentas con rol GESTOR o AUDITOR necesitan una app autenticadora (MFA). ' +
              'Pide al administrador que la configure con el procedimiento de alta.'
            : 'El inicio de sesión se canceló o caducó.'}
        </p>
        <Link to="/" className="mt-4 inline-block text-sky-800 underline">
          Volver al inicio
        </Link>
      </>
    );
  }

  return (
    <p role="status" className="mt-2">
      Completando el inicio de sesión…
    </p>
  );
}
