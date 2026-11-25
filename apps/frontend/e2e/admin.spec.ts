import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {
  AnalyticsReportView,
  SecurityAlertView,
  SecurityIncidentView,
} from '@examnexus/shared';
import {
  LIVE_MODE,
  adminRoutes,
  captureApiResponse,
  captureDownload,
  openProtected,
  requireLiveFixture,
  setupApi,
  waitForApiResponse,
} from './support';
import { type Paged } from './support/fixtures';
import { ADMIN_USER } from './support/fixtures';

test('admin analytics renders computed metrics and exports attempts CSV', async ({ page }) => {
  await setupApi(page, { user: ADMIN_USER, routes: adminRoutes() });

  const analytics = await captureApiResponse<AnalyticsReportView>(
    page,
    'GET',
    '/admin/analytics',
    () => openProtected(page, '/admin/reports', 'admin'),
  );
  await expect(page.getByRole('heading', { name: 'Reports and analytics' })).toBeVisible();
  const organisationsCard = page.locator('section').filter({ hasText: 'Organisations' }).first();
  await expect(organisationsCard.getByText(String(analytics.summary.organisations), { exact: true })).toBeVisible();
  await expect(page.getByText(analytics.byOrganisation[0]!.organisation, { exact: true }).first()).toBeVisible();

  if (!LIVE_MODE) {
    const nav = page.locator('nav');
    const reportsLink = nav.getByRole('link', { name: /Reports and Analytics/ });
    await expect(reportsLink).toBeVisible();
    await expect(reportsLink).toHaveAttribute('href', '/admin/reports');
  }

  const download = await captureDownload(page, () => page.getByRole('button', { name: 'Export CSV' }).click());
  expect(download.suggestedFilename()).toBe('examnexus-attempts-30d.csv');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.length).toBeGreaterThan(0);
  if (!LIVE_MODE) expect(csv).toContain('kind,range,attempts');
});

test('security centre lists alerts/incidents and records an investigation', async ({ page }) => {
  await setupApi(page, { user: ADMIN_USER, routes: adminRoutes() });

  const alertsPromise = waitForApiResponse<Paged<SecurityAlertView>>(page, 'GET', '/admin/security/alerts');
  const incidentsPromise = waitForApiResponse<Paged<SecurityIncidentView>>(page, 'GET', '/admin/security/incidents');
  await openProtected(page, '/admin/security', 'admin');
  const alerts = await alertsPromise;
  const incidents = await incidentsPromise;

  const alert = alerts.items.find((item) => item.status === 'OPEN');
  const incident = incidents.items[0];
  requireLiveFixture(alert && incident, 'an open security alert and at least one incident');
  if (!alert || !incident) throw new Error('Security centre fixture returned no reviewable alert/incident.');

  await expect(page.getByRole('heading', { name: 'Security centre' })).toBeVisible();
  await expect(page.getByText(alert.title, { exact: true })).toBeVisible();
  await expect(page.getByText(incident.classification, { exact: true })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true }).first()).toBeVisible();

  if (!LIVE_MODE) {
    const securityLink = page.locator('nav').getByRole('link', { name: /Security Centre/ });
    await expect(securityLink).toBeVisible();
    await expect(securityLink).toHaveAttribute('href', '/admin/security');
  }

  const investigated = await captureApiResponse<SecurityAlertView>(
    page,
    'PATCH',
    `/admin/security/alerts/${alert.id}`,
    () => page.getByRole('button', { name: 'Investigate' }).click(),
  );
  expect(investigated.status).toBe('INVESTIGATING');
  await expect(page.getByText('INVESTIGATING', { exact: true }).first()).toBeVisible();
});
