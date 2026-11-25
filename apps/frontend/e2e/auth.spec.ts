import { expect, test } from '@playwright/test';
import type { OrganisationDashboard } from '@examnexus/shared';
import {
  MOCK_ACCESS_TOKEN,
  ok,
  route,
  setupApi,
  signIn,
  waitForApiResponse,
} from './support/api';
import { dashboardRoutes, ORG_DASHBOARD, ORG_USER } from './support/fixtures';

test('login page renders stable controls and blocks invalid submissions', async ({ page }) => {
  await setupApi(page, { user: null });
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('#identifier')).toBeVisible();
  await expect(page.locator('#secret')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Super Admin PIN' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register an organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verify a certificate' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your registered identifier')).toBeVisible();
  await expect(page.getByText('Secret must be at least 12 characters')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.locator('#identifier').fill('ab');
  await page.locator('#secret').fill('short');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your registered identifier')).toBeVisible();
  await expect(page.getByText('Secret must be at least 12 characters')).toBeVisible();

  await page.getByRole('button', { name: 'Super Admin PIN' }).click();
  await expect(page.locator('#secret')).toHaveAttribute('autocomplete', 'off');
  await expect(page.getByText('PIN login is available only to Super Admins', { exact: false })).toBeVisible();
});

test('valid credentials land on the role destination', async ({ page }) => {
  await setupApi(page, {
    user: null,
    routes: [
      route('POST', '/auth/login', () =>
        ok({ status: 'AUTHENTICATED', accessToken: MOCK_ACCESS_TOKEN, expiresIn: 3600, user: ORG_USER }),
      ),
      ...dashboardRoutes(),
    ],
  });

  const dashboardPromise = waitForApiResponse<OrganisationDashboard>(page, 'GET', '/organisations/me/dashboard');
  await signIn(page, 'org', /\/org\/dashboard$/);
  const dashboard = await dashboardPromise;

  await expect(page.getByRole('heading', { name: dashboard.organisation.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Organisation Dashboard/ })).toBeVisible();
  expect(dashboard.organisation.name).toBe(ORG_DASHBOARD.organisation.name);
});

test('protected routes redirect anonymous visitors to login with the intended destination', async ({ page }) => {
  // Live mode intentionally uses a fresh, unauthenticated context here so the
  // real API's 401/refresh path is exercised without any route interception.
  await setupApi(page, { user: null });
  await page.goto('/org/dashboard');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('#identifier')).toBeVisible();
  const from = await page.evaluate(() =>
    (window.history.state as { usr?: { from?: string } } | null)?.usr?.from,
  );
  expect(from).toBe('/org/dashboard');
});
