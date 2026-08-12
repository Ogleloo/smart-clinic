@AGENTS.md

# CLAUDE.md — standing instructions

## Migrations must be committed, not just applied

Production, preview and local development all share one Supabase project
(`bffhjvpkfivtbzqielve`). Applying a migration — via the CLI, the
dashboard SQL editor, or the Supabase MCP connector — makes it live
immediately, on whatever branch. None of that touches git.

**Every migration must be committed to `supabase/migrations/` in the
same change that applies it.** A migration applied but not committed
does not exist as far as this repo is concerned: clone the repo and you
get an application with no database. That already happened once — 43
migrations were applied live over the course of this project with zero
record in git, recovered after the fact in
`chore/migrations-into-version-control` by reading the SQL back out of
`supabase_migrations.schema_migrations`. Recovery worked this time only
because Supabase still had the original statements; it would not have if
the project were ever deleted or reset.
