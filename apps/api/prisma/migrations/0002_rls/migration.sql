-- Row-Level Security policy installation.
-- Apply AFTER Prisma has created the tables (prisma migrate deploy / db push).
-- The application must set app.tenant_id (and optionally app.elevated) inside
-- every transaction before touching tenant data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.is_elevated()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.elevated', true), 'false') = 'true';
$$;

CREATE OR REPLACE FUNCTION app.set_context(p_tenant uuid, p_elevated boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', COALESCE(p_tenant::text, ''), true);
  PERFORM set_config('app.elevated', COALESCE(p_elevated::text, 'false'), true);
END;
$$;

DO $$
DECLARE
  t text;
  strict_tables text[] := ARRAY[
    'organisation_verifications','organisation_memberships','departments','branches',
    'roles','role_permissions','user_roles',
    'examinations','examination_versions','examination_sections','examination_security_policies',
    'question_banks','questions','question_options','question_sets','question_set_items',
    'candidates','candidate_examinations','examination_attempts','candidate_answers',
    'submissions','evaluations','results','certificates',
    'integrations','integration_credentials','integration_permissions','webhook_endpoints','webhook_events',
    'examination_security_events','risk_assessments','exam_sessions','device_registrations',
    'subscriptions','payments','file_objects'
  ];
  nullable_tables text[] := ARRAY[
    'users','user_profiles','user_sessions','authentication_events','mfa_methods','recovery_codes',
    'audit_logs','security_alerts','security_incidents','notifications','notification_templates',
    'api_clients','api_keys'
  ];
BEGIN
  FOREACH t IN ARRAY strict_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (app.is_elevated() OR "tenantId" = app.current_tenant_id())
        WITH CHECK (app.is_elevated() OR "tenantId" = app.current_tenant_id())
    $p$, t);
  END LOOP;

  -- Platform rows ("tenantId" IS NULL) are visible only to elevated Super Admin contexts.
  FOREACH t IN ARRAY nullable_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (app.is_elevated() OR "tenantId" = app.current_tenant_id())
        WITH CHECK (app.is_elevated() OR "tenantId" = app.current_tenant_id())
    $p$, t);
  END LOOP;
END $$;

-- organisations itself: tenants may read only their own row; elevated contexts see all.
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organisations
  USING (app.is_elevated() OR id = app.current_tenant_id())
  WITH CHECK (app.is_elevated() OR id = app.current_tenant_id());

-- Permission catalogue is global reference data: readable by all authenticated contexts.
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY permissions_read ON permissions FOR SELECT USING (true);
-- Writes require an elevated context.
CREATE POLICY permissions_write ON permissions FOR ALL
  USING (app.is_elevated())
  WITH CHECK (app.is_elevated());

-- Super Admin credentials and system health are platform-only tables.
ALTER TABLE super_admin_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON super_admin_credentials
  USING (app.is_elevated())
  WITH CHECK (app.is_elevated());

ALTER TABLE system_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_health_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON system_health_events
  USING (app.is_elevated())
  WITH CHECK (app.is_elevated());
