import { ApiStatus } from '../components/ApiStatus.tsx';

export function HomePage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Donaciones seguras</h1>
      <p className="mt-2 text-slate-600">
        El catálogo y las donaciones se añadirán por fases (ver tasks.md). Ya puedes iniciar sesión
        y consultar tu historial en «Mi cuenta».
      </p>
      <ApiStatus />
    </>
  );
}
