import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { PageTitle } from '../components/PageTitle.tsx';

/** Destino de `redirect_uri`: canjea el código (con PKCE) por los tokens y vuelve a la app. */
export function CallbackPage() {
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    completeLogin()
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch(() => {
        setFailed(true);
      });
  }, [completeLogin, navigate]);

  if (failed) {
    return (
      <>
        <PageTitle>Error de inicio de sesión</PageTitle>
        <h1 className="text-2xl font-bold">No se pudo iniciar sesión</h1>
        <p role="alert" className="mt-2 text-red-800">
          El inicio de sesión se canceló o caducó.
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
