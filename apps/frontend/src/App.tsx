import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@examnexus/shared';
import { AppShell } from './app/AppShell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { PermissionGate } from './components/auth/PermissionGate';
import { AuthProvider, useAuth } from './features/auth/AuthProvider';
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AccountLinkPages';
import { LoginPage } from './features/auth/LoginPage';
import { MfaPage } from './features/auth/MfaPage';
import { AdminOrganisationDetailPage, AdminOrganisationsPage } from './features/admin/AdminOrganisationsPage';
import { AdminOverviewPage } from './features/admin/AdminOverviewPage';
import { AdminRolesPage } from './features/admin/AdminRolesPage';
import { AdminUsersPage } from './features/admin/AdminUsersPage';
import { AdminAuditLogsPage, AdminAuthLogsPage } from './features/admin/AdminLogsPage';
import {
  AdminAnalyticsPage,
  AdminConfigurationPage,
  AdminLiveAttemptsPage,
  AdminNotificationsPage,
  AdminSecurityCentrePage,
  AdminSubscriptionsPage,
  AdminSupportPage,
  AdminSystemHealthPage,
} from './features/admin/Phase6Pages';
import {
  ApiManagementPage,
  IntegrationMonitoringPage,
  IntegrationsPage,
} from './features/integrations/IntegrationPages';
import { OrganisationRegistrationPage } from './features/organisations/OrganisationRegistrationPage';
import {
  TenantCandidatesPage,
  TenantDashboardPage,
  TenantProfilePage,
  TenantRolesPage,
  TenantUsersPage,
} from './features/organisations/TenantPages';
import { ProfilePage } from './features/profile/ProfilePage';
import { CandidatePortalPage } from './features/examinations/CandidatePortalPage';
import { ExaminationManagementPage } from './features/examinations/ExaminationManagementPage';
import { EvaluationPage, LiveMonitoringPage } from './features/examinations/MonitoringPages';
import { QuestionBankPage } from './features/examinations/QuestionBankPage';
import { AdvancedEvaluationPage } from './features/advanced/EvaluationPages';
import { ResultApprovalPage } from './features/advanced/ResultApprovalPage';
import { ProctoringPage } from './features/advanced/ProctoringPages';
import { AdvancedReportsPage } from './features/advanced/ReportsPage';
import { CertificateVerificationPage, CertificatesPage } from './features/advanced/CertificatePages';
import { ModulePlaceholderPage } from './features/platform/ModulePlaceholderPage';
import { NotFoundPage } from './features/platform/NotFoundPage';
import { PlatformPage } from './features/platform/PlatformPage';

function Protected({ permission, children }: { permission?: string | string[]; children: ReactNode }) {
  return (
    <ProtectedRoute>
      {permission ? <PermissionGate permission={permission}>{children}</PermissionGate> : children}
    </ProtectedRoute>
  );
}

function LogoutPage() {
  const { logout, status } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    void logout().then(() => navigate('/login', { replace: true }));
  }, [logout, navigate]);
  return <p className="py-10 text-sm text-muted">Signing out… ({status})</p>;
}

function RoutesContent() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<PlatformPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="mfa" element={<MfaPage />} />
        <Route path="register" element={<OrganisationRegistrationPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="invitations/accept" element={<AcceptInvitationPage />} />
        <Route path="password/forgot" element={<ForgotPasswordPage />} />
        <Route path="password/reset" element={<ResetPasswordPage />} />
        <Route path="logout" element={<LogoutPage />} />

        <Route
          path="admin/overview"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_ORGANISATIONS_READ}>
              <AdminOverviewPage />
            </Protected>
          }
        />
        <Route
          path="admin/organisations"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_ORGANISATIONS_READ}>
              <AdminOrganisationsPage />
            </Protected>
          }
        />
        <Route
          path="admin/organisations/:id"
          element={
            <Protected permission={[PERMISSIONS.PLATFORM_VERIFICATION_REVIEW, PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE]}>
              <AdminOrganisationDetailPage />
            </Protected>
          }
        />
        <Route
          path="admin/verification"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_VERIFICATION_REVIEW}>
              <AdminOrganisationsPage verificationOnly />
            </Protected>
          }
        />
        <Route
          path="admin/users"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_USERS_READ}>
              <AdminUsersPage />
            </Protected>
          }
        />
        <Route
          path="admin/roles"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_ROLES_READ}>
              <AdminRolesPage />
            </Protected>
          }
        />
        <Route
          path="admin/auth-logs"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_AUTH_EVENTS_READ}>
              <AdminAuthLogsPage />
            </Protected>
          }
        />
        <Route
          path="admin/audit-logs"
          element={
            <Protected permission={PERMISSIONS.PLATFORM_AUDIT_READ}>
              <AdminAuditLogsPage />
            </Protected>
          }
        />
        <Route path="admin/reports" element={<Protected permission={PERMISSIONS.PLATFORM_REPORTS_READ}><AdminAnalyticsPage /></Protected>} />
        <Route path="admin/security" element={<Protected permission={PERMISSIONS.PLATFORM_SECURITY_READ}><AdminSecurityCentrePage /></Protected>} />
        <Route path="admin/incidents" element={<Protected permission={PERMISSIONS.PLATFORM_SECURITY_READ}><AdminSecurityCentrePage /></Protected>} />
        <Route path="admin/health" element={<Protected permission={PERMISSIONS.PLATFORM_MONITORING_READ}><AdminSystemHealthPage /></Protected>} />
        <Route path="admin/notifications" element={<Protected permission={PERMISSIONS.PLATFORM_MONITORING_READ}><AdminNotificationsPage /></Protected>} />
        <Route path="admin/subscriptions" element={<Protected permission={PERMISSIONS.PLATFORM_ORGANISATIONS_READ}><AdminSubscriptionsPage /></Protected>} />
        <Route path="admin/support" element={<Protected permission={PERMISSIONS.PLATFORM_SUPPORT_MANAGE}><AdminSupportPage /></Protected>} />
        <Route path="admin/configuration" element={<Protected permission={PERMISSIONS.PLATFORM_CONFIGURATION_MANAGE}><AdminConfigurationPage /></Protected>} />
        <Route path="admin/live-attempts" element={<Protected permission={PERMISSIONS.PLATFORM_MONITORING_READ}><AdminLiveAttemptsPage /></Protected>} />
        <Route path="org/integrations" element={<Protected permission={PERMISSIONS.ORG_INTEGRATIONS_READ}><IntegrationsPage /></Protected>} />
        <Route path="org/api-management" element={<Protected permission={PERMISSIONS.ORG_API_MANAGE}><ApiManagementPage /></Protected>} />
        <Route path="admin/integration-monitoring" element={<Protected permission={PERMISSIONS.PLATFORM_INTEGRATIONS_READ}><IntegrationMonitoringPage /></Protected>} />

        <Route
          path="org/dashboard"
          element={
            <Protected permission={PERMISSIONS.ORG_DASHBOARD_READ}>
              <TenantDashboardPage />
            </Protected>
          }
        />
        <Route path="org" element={<Navigate to="/org/dashboard" replace />} />
        <Route
          path="org/profile"
          element={
            <Protected permission={PERMISSIONS.ORG_PROFILE_MANAGE}>
              <TenantProfilePage />
            </Protected>
          }
        />
        <Route
          path="org/users"
          element={
            <Protected permission={PERMISSIONS.ORG_USERS_READ}>
              <TenantUsersPage />
            </Protected>
          }
        />
        <Route
          path="org/roles"
          element={
            <Protected permission={PERMISSIONS.ORG_ROLES_READ}>
              <TenantRolesPage />
            </Protected>
          }
        />
        <Route
          path="org/candidates"
          element={
            <Protected permission={PERMISSIONS.ORG_CANDIDATES_READ}>
              <TenantCandidatesPage />
            </Protected>
          }
        />
        <Route
          path="org/examinations"
          element={
            <Protected permission={PERMISSIONS.ORG_EXAMINATIONS_MANAGE}>
              <ExaminationManagementPage />
            </Protected>
          }
        />
        <Route
          path="org/question-bank"
          element={
            <Protected permission={PERMISSIONS.ORG_QUESTION_BANK_READ}>
              <QuestionBankPage />
            </Protected>
          }
        />
        <Route
          path="org/live-monitoring"
          element={
            <Protected permission={PERMISSIONS.ORG_LIVE_MONITORING}>
              <LiveMonitoringPage />
            </Protected>
          }
        />
        <Route
          path="org/evaluation"
          element={
            <Protected permission={PERMISSIONS.ORG_EXAMINATIONS_READ}>
              <EvaluationPage />
            </Protected>
          }
        />
        <Route
          path="org/evaluation/advanced"
          element={
            <Protected permission={[PERMISSIONS.ORG_EVALUATION_READ, PERMISSIONS.ORG_EVALUATION_MANAGE]}>
              <AdvancedEvaluationPage />
            </Protected>
          }
        />
        <Route
          path="org/evaluation/advanced/:attemptId"
          element={
            <Protected permission={[PERMISSIONS.ORG_EVALUATION_READ, PERMISSIONS.ORG_EVALUATION_MANAGE]}>
              <AdvancedEvaluationPage />
            </Protected>
          }
        />
        <Route
          path="org/results/approval"
          element={
            <Protected permission={PERMISSIONS.ORG_EVALUATION_MANAGE}>
              <ResultApprovalPage />
            </Protected>
          }
        />
        <Route
          path="org/proctoring"
          element={
            <Protected permission={PERMISSIONS.ORG_PROCTORING_READ}>
              <ProctoringPage />
            </Protected>
          }
        />
        <Route
          path="org/proctoring/:attemptId"
          element={
            <Protected permission={PERMISSIONS.ORG_PROCTORING_READ}>
              <ProctoringPage />
            </Protected>
          }
        />
        <Route
          path="org/reports"
          element={
            <Protected permission={PERMISSIONS.ORG_REPORTS_READ}>
              <AdvancedReportsPage />
            </Protected>
          }
        />
        <Route
          path="org/certificates"
          element={
            <Protected permission={PERMISSIONS.ORG_CERTIFICATES_MANAGE}>
              <CertificatesPage />
            </Protected>
          }
        />
        <Route path="verify-certificate" element={<CertificateVerificationPage />} />
        <Route
          path="candidate/exams"
          element={
            <Protected>
              <CandidatePortalPage />
            </Protected>
          }
        />

        <Route
          path="profile"
          element={
            <Protected>
              <ProfilePage />
            </Protected>
          }
        />
        <Route path="module/:slug" element={<ModulePlaceholderPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RoutesContent />
    </AuthProvider>
  );
}
