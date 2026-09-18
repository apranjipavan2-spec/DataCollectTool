-- Runnable check for migration 0048's empty-context-bypass RLS policies.
-- Proves: authenticated tenant users are strictly isolated, while pre-auth
-- (login/public survey) and master_admin (empty context) bypass — matching how
-- the app sets app.current_tenant. Requires Docker (no local Postgres needed):
--
--   docker run -d --name fg_rls_test -e POSTGRES_PASSWORD=pw -e POSTGRES_USER=fieldgovern \
--     -e POSTGRES_DB=fieldgovern -p 55432:5432 postgres:16-alpine
--   docker exec -i fg_rls_test psql -U fieldgovern -d fieldgovern < backend/tests/rls_policy_check.sql
--   docker rm -f fg_rls_test
--
-- Expected: T1=2, T2=1(tenantA-row), T3_PASS notice, T4=2, T5=1, T6=0, T7=1.

\set ON_ERROR_STOP on
DROP ROLE IF EXISTS fieldgovern_app;
CREATE ROLE fieldgovern_app LOGIN NOINHERIT;
ALTER ROLE fieldgovern_app NOSUPERUSER NOBYPASSRLS;

DROP TABLE IF EXISTS submissions, shared_files;
CREATE TABLE submissions (id serial primary key, tenant_id uuid not null, data text);
CREATE TABLE shared_files (id serial primary key, tenant_id uuid not null,
                           shared_with_tenants uuid[], data text);
GRANT SELECT, INSERT, UPDATE, DELETE ON submissions, shared_files TO fieldgovern_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fieldgovern_app;

-- policy expressions verbatim from migration 0048
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON submissions
 USING (COALESCE(current_setting('app.current_tenant', true), '') = '' OR tenant_id::text = current_setting('app.current_tenant', true))
 WITH CHECK (COALESCE(current_setting('app.current_tenant', true), '') = '' OR tenant_id::text = current_setting('app.current_tenant', true));

ALTER TABLE shared_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared_files
 USING (COALESCE(current_setting('app.current_tenant', true), '') = '' OR tenant_id::text = current_setting('app.current_tenant', true) OR NULLIF(current_setting('app.current_tenant', true), '')::uuid = ANY(COALESCE(shared_with_tenants, ARRAY[]::uuid[])))
 WITH CHECK (COALESCE(current_setting('app.current_tenant', true), '') = '' OR tenant_id::text = current_setting('app.current_tenant', true));

INSERT INTO submissions (tenant_id, data) VALUES
 ('11111111-1111-1111-1111-111111111111','tenantA-row'),
 ('22222222-2222-2222-2222-222222222222','tenantB-row');
INSERT INTO shared_files (tenant_id, shared_with_tenants, data) VALUES
 ('22222222-2222-2222-2222-222222222222', ARRAY['11111111-1111-1111-1111-111111111111']::uuid[], 'B-shared-with-A');

SET ROLE fieldgovern_app;

\echo '--- T1: empty context sees ALL (login/public/master_admin) -> expect 2'
SET app.current_tenant = '';
SELECT count(*) AS t1 FROM submissions;

\echo '--- T2: tenant A sees ONLY A -> expect 1 / tenantA-row'
SET app.current_tenant = '11111111-1111-1111-1111-111111111111';
SELECT count(*) AS t2_count, string_agg(data, ',') AS t2_rows FROM submissions;

\echo '--- T3: cross-tenant INSERT blocked by WITH CHECK -> expect T3_PASS'
DO $$ BEGIN
  INSERT INTO submissions (tenant_id, data) VALUES ('22222222-2222-2222-2222-222222222222','forge');
  RAISE NOTICE 'T3_FAIL: cross-tenant insert was ALLOWED';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T3_PASS: blocked';
END $$;

\echo '--- T4: own-tenant INSERT allowed -> expect 2'
INSERT INTO submissions (tenant_id, data) VALUES ('11111111-1111-1111-1111-111111111111','A-own');
SELECT count(*) AS t4 FROM submissions;

\echo '--- T5: shared file visible to shared tenant A -> expect 1'
SELECT count(*) AS t5 FROM shared_files;

\echo '--- T6: non-shared tenant C sees nothing -> expect 0'
SET app.current_tenant = '33333333-3333-3333-3333-333333333333';
SELECT count(*) AS t6 FROM shared_files;

\echo '--- T7: empty context on shared table no cast error -> expect 1'
SET app.current_tenant = '';
SELECT count(*) AS t7 FROM shared_files;

RESET ROLE;
