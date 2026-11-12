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

  it('T14: si el trigger exige MFA, lo explica sin repetir el texto de la URL', async () => {
    // Así llega el error de oidc-client-ts cuando Cognito redirige con `error_description`.
    const error = Object.assign(new Error('invalid_request'), {
      error_description: 'PreTokenGeneration failed with error MFA_REQUERIDO: <texto>',
    });
    renderCallback(() => Promise.reject(error));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('necesitan una app autenticadora (MFA)');
    expect(alert).not.toHaveTextContent('<texto>');
    expect(alert).not.toHaveTextContent('PreTokenGeneration');
  });
});
