-- Hotfix for the LiveJob materialized view deploy (2026-05-15).
--
-- The original migration (20260515000000_add_livejob_materialized_view) ran
-- via `prisma migrate deploy` using the postgres admin connection, so the
-- new view inherited postgres as its owner. The runtime application uses
-- the scoped `vera_app` role, which had no SELECT permission on the
-- view — every dashboard read returned `ERROR: permission denied for
-- materialized view LiveJob (code 42501)` until this grant landed.
--
-- DO blocks make this idempotent against environments where vera_app
-- doesn't exist yet (e.g., a fresh local dev DB owned by your macOS user).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_app') THEN
    EXECUTE 'GRANT SELECT ON "LiveJob" TO vera_app';
  END IF;
END $$;
