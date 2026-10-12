-- DESIGN PROTOTYPE — NOT APPLIED, NOT A MIGRATION, NOT the registration change. It exists so that the
-- database-level invariants of the mandatory-identification requirement (docs/proposals/supervisor_requirements.md
-- §1) can be tested on a disposable local stack: validation, normalisation, uniqueness under concurrency, minimum
-- exposure. Registration, linking and correction flows are design-only and are NOT implemented here.
--
-- Open decisions (see the .md) deliberately left visible:
--   * storage of the number: this prototype keeps the normalised number in a column no app role can SELECT.
--     Recommended for production: also/instead a keyed hash (HMAC with a Vault-held key) for uniqueness and
--     exact-match lookup — SA ID numbers have too little entropy for an unkeyed hash.
--   * passport country codes: ISO 3166-1 alpha-3 (as printed in the passport MRZ).

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create type public.identity_document_type as enum ('sa_id', 'passport');
create type public.identity_document_status as enum ('active', 'replaced', 'revoked');

-- Normalisation: upper case, strip spaces, hyphens, dots and slashes. Nothing else is rewritten.
create or replace function private.normalize_document_number(p_raw text)
returns text language sql immutable
set search_path = pg_temp
as $$ select nullif(upper(regexp_replace(coalesce(p_raw, ''), '[\s\-./]', '', 'g')), '') $$;

-- South African ID: 13 digits YYMMDD SSSS C A Z. Valid calendar date (either century, not in the future), citizenship
-- digit 0 (citizen) / 1 (permanent resident) / 2 (refugee), Luhn check digit. Gender digits are NOT interpreted.
create or replace function private.is_valid_sa_id(p_number text)
returns boolean language plpgsql stable   -- stable, not immutable: the "not in the future" test reads current_date
set search_path = pg_temp
as $$
declare
  d int[]; total int := 0; v int; i int; dob date; yy int;
begin
  if p_number is null or p_number !~ '^\d{13}$' then return false; end if;
  yy := substring(p_number, 1, 2)::int;
  begin
    dob := make_date(2000 + yy, substring(p_number, 3, 2)::int, substring(p_number, 5, 2)::int);
    if dob > current_date then
      dob := make_date(1900 + yy, substring(p_number, 3, 2)::int, substring(p_number, 5, 2)::int);
    end if;
  exception when others then
    return false;
  end;
  if substring(p_number, 11, 1) not in ('0', '1', '2') then return false; end if;
  -- Luhn over all 13 digits: from the right, double every second digit.
  for i in 1..13 loop
    v := substring(p_number, 14 - i, 1)::int;
    if i % 2 = 0 then v := v * 2; if v > 9 then v := v - 9; end if; end if;
    total := total + v;
  end loop;
  return total % 10 = 0;
end;
$$;

-- Passport: no country-specific format is assumed. 5–20 letters/digits after normalisation, plus an issuing
-- country (ISO 3166-1 alpha-3). Country-specific checks (or MRZ parsing) can be added per country later.
create or replace function private.is_valid_passport(p_number text, p_country text)
returns boolean language sql immutable
set search_path = pg_temp
as $$ select p_number ~ '^[A-Z0-9]{5,20}$' and p_country ~ '^[A-Z]{3}$' $$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC: revoke it. The CHECK constraints below run these validators as the
-- INSERTING role, so only the roles that may write documents get EXECUTE (service_role here; in production the
-- table owner via SECURITY DEFINER registration functions).
revoke all on function private.normalize_document_number(text) from public, anon, authenticated;
revoke all on function private.is_valid_sa_id(text) from public, anon, authenticated;
revoke all on function private.is_valid_passport(text, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.normalize_document_number(text), private.is_valid_sa_id(text),
  private.is_valid_passport(text, text) to service_role;

create table public.patient_identity_documents (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.profiles(id) on delete restrict,
  document_type    public.identity_document_type not null,
  issuing_country  char(3) not null,
  number_normalized text not null,
  number_last4     text generated always as (right(number_normalized, 4)) stored,
  status           public.identity_document_status not null default 'active',
  replaced_by      uuid references public.patient_identity_documents(id),
  change_reason    text,
  recorded_by      uuid references public.profiles(id),
  recorded_at      timestamptz not null default now(),
  verified_by      uuid references public.profiles(id),   -- staff who saw the physical document
  verified_at      timestamptz,
  constraint document_number_is_normalized check (number_normalized = private.normalize_document_number(number_normalized)),
  constraint sa_id_is_valid check (document_type <> 'sa_id' or (issuing_country = 'ZAF' and private.is_valid_sa_id(number_normalized))),
  constraint passport_is_valid check (document_type <> 'passport' or private.is_valid_passport(number_normalized, issuing_country))
);
-- The duplicate-prevention invariant: one ACTIVE holder per document, enforced by the database (so two concurrent
-- registrations with the same document cannot both succeed — the second gets 23505).
create unique index patient_identity_documents_unique_active
  on public.patient_identity_documents (document_type, issuing_country, number_normalized)
  where status = 'active';
-- At most one active document of each type/country per patient (a person may hold an SA ID AND a passport).
create unique index patient_identity_documents_one_per_kind
  on public.patient_identity_documents (patient_id, document_type, issuing_country)
  where status = 'active';

-- Minimum exposure: no app role reads or writes the table directly. Registration / verification / correction would
-- go through SECURITY DEFINER functions (design only) that return at most the last four characters.
alter table public.patient_identity_documents enable row level security;
revoke all on public.patient_identity_documents from public, anon, authenticated;
-- Explicit deny-all (documents intent; a table with RLS and no policy is flagged by system_health_check).
create policy patient_identity_documents_no_direct_access on public.patient_identity_documents
  as restrictive for all to authenticated using (false) with check (false);

commit;
