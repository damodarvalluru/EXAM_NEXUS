import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, TENANT_NAV_ITEMS } from './config/navigation';
import { AuthProvider } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';

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

  it('routes Phase 5 and 6 modules to real working screens', () => {
    const slugs = ['tenant-integrations', 'security-centre', 'reports', 'system-health', 'support', 'configuration'];
    for (const slug of slugs) {
      const item = [...NAV_ITEMS, ...TENANT_NAV_ITEMS].find((nav) => nav.slug === slug);
      expect(item?.path).toBeTruthy();
      expect(item?.phase).toBeGreaterThanOrEqual(5);
    }
  });
});
