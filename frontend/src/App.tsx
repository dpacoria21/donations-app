import { lazy, Suspense } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router';
import { useAuth } from './auth/context.ts';
import { AccountPage } from './pages/AccountPage.tsx';
import { CallbackPage } from './pages/CallbackPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { ProjectPage } from './pages/ProjectPage.tsx';

// Las páginas del GESTOR (con React Hook Form y Zod) se descargan solo si se visitan.
const ManagePage = lazy(() =>
  import('./pages/ManagePage.tsx').then((module) => ({ default: module.ManagePage })),
);
const ProjectFormPage = lazy(() =>
  import('./pages/ProjectFormPage.tsx').then((module) => ({ default: module.ProjectFormPage })),
);

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 ${isActive ? 'font-semibold text-sky-900 underline' : 'text-sky-800 hover:underline'}`;

export function App() {
  const { user } = useAuth();
  // Solo orienta la navegación: el API exige el grupo GESTOR en cada solicitud.
  const isManager = user?.groups.includes('GESTOR') ?? false;

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
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-2">
          <NavLink to="/" end className={navLink}>
            Proyectos
          </NavLink>
          {isManager && (
            <NavLink to="/gestion" className={navLink}>
              Gestión
            </NavLink>
          )}
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
        <Suspense
          fallback={
            <p role="status" className="mt-2">
              Cargando…
            </p>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/proyectos/:projectId" element={<ProjectPage />} />
            <Route path="/gestion" element={<ManagePage />} />
            <Route path="/gestion/nuevo" element={<ProjectFormPage mode="create" />} />
            <Route path="/gestion/:projectId/editar" element={<ProjectFormPage mode="edit" />} />
            <Route path="/auth/callback" element={<CallbackPage />} />
            <Route path="/cuenta" element={<AccountPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="border-t border-slate-200 px-4 py-4 text-xs text-slate-600">
        <p className="mx-auto max-w-3xl">
          Prototipo académico (Tópicos Avanzados en Ingeniería de Software, EPIS-UNSA). Los
          proyectos y las personas son ficticios y no se procesan pagos reales. Un despliegue real
          exigiría una evaluación legal según la Ley N.º 29733 de Protección de Datos Personales,
          además de revisar privacidad, retención de datos y la normativa de donaciones.
        </p>
      </footer>
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
