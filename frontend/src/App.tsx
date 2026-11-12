import { ApiStatus } from './components/ApiStatus.tsx';

export function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:bg-white focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <p className="font-bold text-sky-800">Fundación AQP-SOLIDARIA</p>
      </header>
      <p role="note" className="bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
        Prototipo académico: las donaciones son simuladas y no se realiza ningún cobro.
      </p>
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold">Donaciones seguras</h1>
        <p className="mt-2 text-slate-600">
          Esqueleto inicial de la SPA. El catálogo, el inicio de sesión y las donaciones se añadirán
          por fases (ver tasks.md).
        </p>
        <ApiStatus />
      </main>
    </div>
  );
}
