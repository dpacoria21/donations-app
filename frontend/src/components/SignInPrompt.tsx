import { useAuth } from '../auth/context.ts';
import { PageTitle } from './PageTitle.tsx';

/** Estados previos a una página que requiere sesión. Devuelve `null` si ya hay usuario. */
export function SignInPrompt({ title, message }: { title: string; message: string }) {
  const { configured, status, user, login } = useAuth();
  if (user) return null;

  return (
    <>
      <PageTitle>{title}</PageTitle>
      <h1 className="text-2xl font-bold">{title}</h1>
      {!configured && (
        <p className="mt-2 text-slate-700">
          El inicio de sesión no está configurado. Completa las variables{' '}
          <code>VITE_COGNITO_*</code> de <code>.env</code> con las salidas de la pila.
        </p>
      )}
      {configured && status === 'loading' && (
        <p role="status" className="mt-2">
          Cargando la sesión…
        </p>
      )}
      {configured && status !== 'loading' && (
        <>
          <p className="mt-2 text-slate-700">{message}</p>
          <button
            type="button"
            onClick={() => void login(window.location.pathname)}
            className="mt-4 rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            Iniciar sesión
          </button>
        </>
      )}
    </>
  );
}
