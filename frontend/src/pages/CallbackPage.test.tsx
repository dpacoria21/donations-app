import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuth, renderWithProviders } from '../test/render.tsx';
import { CallbackPage } from './CallbackPage.tsx';

function renderCallback(completeLogin: () => Promise<string>) {
  return renderWithProviders(
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route path="/cuenta" element={<h1>Página de cuenta</h1>} />
    </Routes>,
    { route: '/auth/callback?code=abc&state=xyz', auth: fakeAuth({ completeLogin }) },
  );
}

describe('/auth/callback', () => {
  it('canjea el código y vuelve a la ruta pedida', async () => {
    const completeLogin = vi.fn(() => Promise.resolve('/cuenta'));
    renderCallback(completeLogin);
    expect(await screen.findByRole('heading', { name: 'Página de cuenta' })).toBeInTheDocument();
    expect(completeLogin).toHaveBeenCalled();
  });

  it('si el login falla o se cancela, lo informa', async () => {
    renderCallback(() => Promise.reject(new Error('access_denied')));
    expect(await screen.findByRole('alert')).toHaveTextContent('se canceló o caducó');
  });
});
