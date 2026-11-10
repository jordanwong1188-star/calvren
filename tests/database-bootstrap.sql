-- Disposable CI database only; these roles mirror the Supabase API roles.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO service_role;

-- Minimal auth.users stand-in for Calvren's isolated Postgres CI database.
-- The real Supabase project already owns the auth schema.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
