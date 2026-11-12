import { Link } from 'react-router';

export function NotFoundPage({ title = 'Página no encontrada' }: { title?: string }) {
  return (
    <>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-slate-700">Puede que el enlace sea incorrecto o que ya no exista.</p>
      <Link to="/" className="mt-4 inline-block text-sky-800 underline">
        Volver al catálogo
      </Link>
    </>
  );
}
