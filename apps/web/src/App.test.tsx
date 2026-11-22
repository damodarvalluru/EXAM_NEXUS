import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { ModulePlaceholderPage } from './features/platform/ModulePlaceholderPage';

describe('Phase 2 and 3 screens', () => {
  it('renders real password and PIN sign-in modes', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/Email or username/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Super Admin PIN/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeInTheDocument();
  });

  it('shows the target phase for an unimplemented module', () => {
    render(
      <MemoryRouter initialEntries={['/module/security-centre']}>
        <Routes>
          <Route path="/module/:slug" element={<ModulePlaceholderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Security Centre' })).toBeInTheDocument();
  });
});
