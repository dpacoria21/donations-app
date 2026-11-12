import { Link, NavLink, Route, Routes } from 'react-router';
import { useAuth } from './auth/context.ts';
import { AccountPage } from './pages/AccountPage.tsx';
import { CallbackPage } from './pages/CallbackPage.tsx';
import { HomePage } from './pages/HomePage.tsx';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 ${isActive ? 'font-semibold text-sky-900 underline' : 'text-sky-800 hover:underline'}`;

export function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:bg-white focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <Link to="/" className="font-bold text-sky-800">
          Fundación AQP-SOLIDARIA
        </Link>
        <nav aria-label="Principal" className="flex items-center gap-2">
          <NavLink to="/" end className={navLink}>
            Inicio
          </NavLink>
          <NavLink to="/cuenta" className={navLink}>
            Mi cuenta
          </NavLink>
          <SessionButton />
        </nav>
      </header>
      <p role="note" className="bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
        Prototipo académico: las donaciones son simuladas y no se realiza ningún cobro.
      </p>
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth/callback" element={<CallbackPage />} />
          <Route path="/cuenta" element={<AccountPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

/** Botón de sesión. Ocultarlo no protege nada: el API valida cada solicitud. */
function SessionButton() {
  const { configured, status, login, logout } = useAuth();
  if (!configured || status === 'loading') return null;

  const className =
    'rounded border border-sky-700 px-3 py-1 font-semibold text-sky-800 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700';
  return status === 'authenticated' ? (
    <button type="button" onClick={() => void logout()} className={className}>
      Cerrar sesión
    </button>
  ) : (
    <button type="button" onClick={() => void login()} className={className}>
      Iniciar sesión
    </button>
  );
}

function NotFound() {
  return (
    <>
      <h1 className="text-2xl font-bold">Página no encontrada</h1>
      <Link to="/" className="mt-4 inline-block text-sky-800 underline">
        Volver al inicio
      </Link>
    </>
  );
}
