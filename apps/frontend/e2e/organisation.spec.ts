import { expect, test } from '@playwright/test';
import type { OrganisationDashboard } from '@examnexus/shared';
import { LIVE_MODE, openProtected, setupApi, waitForApiResponse } from './support/api';
import { dashboardRoutes, LIMITED_ORG_USER, ORG_DASHBOARD } from './support/fixtures';

test('organisation dashboard renders live data and permission-gated navigation', async ({ page }) => {
  await setupApi(page, { user: LIMITED_ORG_USER, routes: dashboardRoutes() });

  const dashboardPromise = waitForApiResponse<OrganisationDashboard>(page, 'GET', '/organisations/me/dashboard');
  await openProtected(page, '/org/dashboard', 'limitedOrg');
  const dashboard = await dashboardPromise;

  await expect(page.getByRole('heading', { name: dashboard.organisation.name, exact: true })).toBeVisible();
  await expect(page.getByText(`${dashboard.organisation.slug} · ${dashboard.organisation.status}`)).toBeVisible();

  const activeUsersCard = page.locator('section').filter({ hasText: 'Active users' }).first();
  await expect(activeUsersCard.getByText(String(dashboard.counts.activeUsers), { exact: true })).toBeVisible();
  await expect(page.getByText(dashboard.recentExaminations[0]!.title)).toBeVisible();
  await expect(page.getByText(dashboard.roleDistribution[0]!.role)).toBeVisible();

  if (LIVE_MODE) {
    // Live permissions are deployment-specific; only the dashboard's own link
    // is universal. Offline mode below asserts the exact limited-permission set.
    await expect(page.locator('nav').getByRole('link', { name: /Organisation Dashboard/ })).toBeVisible();
    return;
  }

  expect(dashboard.organisation.name).toBe(ORG_DASHBOARD.organisation.name);

  const nav = page.locator('nav');
  const visibleLinks = [
    ['Organisation Dashboard', '/org/dashboard'],
    ['Examination Management', '/org/examinations'],
    ['Advanced Evaluation', '/org/evaluation/advanced'],
  ] as const;
  for (const [label, href] of visibleLinks) {
    const link = nav.getByRole('link', { name: new RegExp(label) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
  }

  const gatedOutLabels = [
    'Organisation Profile',
    'Candidates',
    'Advanced Reports',
    'Proctoring Review',
    'Certificates',
    'Security Centre',
  ];
  for (const label of gatedOutLabels) {
    await expect(nav.getByRole('link', { name: new RegExp(label) })).toHaveCount(0);
  }
});
