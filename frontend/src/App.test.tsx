import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('App', () => {
  it('muestra el aviso de prototipo académico (CA-NF10.2)', () => {
    mockFetch(Response.json({ items: [] }));
    render(<App />);
    expect(screen.getByRole('note')).toHaveTextContent('no se realiza ningún cobro');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Donaciones seguras');
  });

  it('indica cuántos proyectos devuelve el API', async () => {
    const fetchMock = mockFetch(Response.json({ items: [{}, {}, {}] }));
    render(<App />);
    expect(await screen.findByText(/Conectado: 3 proyectos/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/projects$/),
      expect.anything(),
    );
  });

  it('informa si el backend no responde', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    render(<App />);
    expect(await screen.findByText(/No se pudo conectar/)).toBeInTheDocument();
  });
});
