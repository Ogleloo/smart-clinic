-- DESIGN PROTOTYPE (revision 5) — NOT APPLIED, NOT A MIGRATION, NOT the registration change.
-- Purpose: test on a disposable local stack the database invariants behind mandatory identification
-- (docs/proposals/supervisor_requirements.md §1): validation, normalisation, keyed-hash uniqueness under concurrency,
-- replacement, single-use claim codes, and that NO document number or claim code is ever stored in plaintext.
--
-- Decisions applied: D-ID1 keyed hash (HMAC-SHA-256, key in Supabase Vault), no plaintext storage, no encryption
-- (no current need to recover the full number); D-ID2 single-use, expiring, hashed claim codes issued after an
-- in-person document check; D-ID3 patients request corrections, staff perform verified replacements.
--
-- Every function here is SECURITY DEFINER (or pure) in schema private and executable only by service_role in the
-- prototype. In production they would be called only from authorised SECURITY DEFINER RPCs (registration, walk-in,
-- check-in verification, correction approval) that do the role/clinic checks; app roles never touch the tables.
--
-- Prerequisites: pgcrypto (schema extensions) and supabase_vault, both installed by default on Supabase (production
-- presence to be confirmed by the read-only inventory). The HMAC key is NOT created here: an operator creates it
-- once with vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'identity_document_hmac_key_v1').
-- The local probe creates a throwaway key on the disposable stack.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to service_role;

create type public.identity_document_type as enum ('sa_id', 'passport');
create type public.identity_document_status as enum ('active', 'replaced', 'revoked');

-- ---------------------------------------------------------------- pure helpers (no secrets)
create or replace function private.normalize_document_number(p_raw text)
returns text language sql immutable
set search_path = pg_temp
as $$ select nullif(upper(regexp_replace(coalesce(p_raw, ''), '[\s\-./]', '', 'g')), '') $$;

-- SA ID: 13 digits YYMMDD SSSS C A Z; real date (century chosen so it is not in the future); citizenship digit
-- 0/1/2; Luhn check digit. Gender digits are NOT interpreted.
create or replace function private.is_valid_sa_id(p_number text)
returns boolean language plpgsql stable   -- stable, not immutable: the "not in the future" test reads current_date
set search_path = pg_temp
as $$
declare
  total int := 0; v int; i int; dob date; yy int;
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
  for i in 1..13 loop
    v := substring(p_number, 14 - i, 1)::int;
    if i % 2 = 0 then v := v * 2; if v > 9 then v := v - 9; end if; end if;
    total := total + v;
  end loop;
  return total % 10 = 0;
end;
$$;

-- Passport: issuing country (ISO 3166-1 alpha-3) required; no country-specific format assumed.
create or replace function private.is_valid_passport(p_number text, p_country text)
returns boolean language sql immutable
set search_path = pg_temp
as $$ select p_number ~ '^[A-Z0-9]{5,20}$' and p_country ~ '^[A-Z]{3}$' $$;

-- ---------------------------------------------------------------- keyed hashing (secret from Vault)
create or replace function private.identity_hmac_key()
returns bytea language plpgsql stable security definer
set search_path = pg_temp
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'identity_document_hmac_key_v1';
  if k is null or length(k) < 64 then
    raise exception 'identity document HMAC key is not configured';
  end if;
  return decode(k, 'hex');
end;
$$;

-- HMAC over type, country and normalised number, so equal numbers of different document kinds never collide.
create or replace function private.document_hmac(p_type public.identity_document_type, p_country text, p_normalized text)
returns bytea language sql stable security definer
set search_path = pg_temp
as $$ select extensions.hmac(convert_to(p_type::text || ':' || p_country || ':' || p_normalized, 'UTF8'),
                             private.identity_hmac_key(), 'sha256') $$;

-- ---------------------------------------------------------------- documents (no plaintext number)
create table public.patient_identity_documents (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.profiles(id) on delete restrict,
  document_type   public.identity_document_type not null,
  issuing_country char(3) not null,
  number_hmac     bytea not null check (length(number_hmac) = 32),
  key_version     smallint not null default 1,
  number_last4    text not null check (number_last4 ~ '^[A-Z0-9]{1,4}$'),   -- the only part ever displayed
  status          public.identity_document_status not null default 'active',
  replaced_by     uuid references public.patient_identity_documents(id),
  change_reason   text,
  recorded_by     uuid,
  recorded_at     timestamptz not null default now(),
  verified_by     uuid,               -- staff who saw the physical document
  verified_at     timestamptz,
  constraint sa_id_country check (document_type <> 'sa_id' or issuing_country = 'ZAF')
);
-- Duplicate prevention, enforced by the database: one ACTIVE holder per document. Concurrent registrations of the
-- same document cannot both commit — the second gets 23505.
create unique index patient_identity_documents_unique_active
  on public.patient_identity_documents (document_type, issuing_country, number_hmac) where status = 'active';
create unique index patient_identity_documents_one_per_kind
  on public.patient_identity_documents (patient_id, document_type, issuing_country) where status = 'active';

alter table public.patient_identity_documents enable row level security;
revoke all on public.patient_identity_documents from public, anon, authenticated;
create policy patient_identity_documents_no_direct_access on public.patient_identity_documents
  as restrictive for all to authenticated using (false) with check (false);

-- Validate, normalise, hash, insert. The raw number exists only as a function argument.
create or replace function private.register_identity_document(
  p_patient_id uuid, p_type public.identity_document_type, p_country text, p_raw text,
  p_recorded_by uuid default null, p_verified boolean default false
)
returns uuid language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  n text := private.normalize_document_number(p_raw);
  c text := upper(btrim(coalesce(p_country, '')));
  new_id uuid;
begin
  if p_type = 'sa_id' then
    c := 'ZAF';
    if not private.is_valid_sa_id(n) then raise exception 'Not a valid South African ID number' using errcode = '22023'; end if;
  elsif not coalesce(private.is_valid_passport(n, c), false) then
    raise exception 'Passport number and issuing country are required' using errcode = '22023';
  end if;
  insert into public.patient_identity_documents
    (patient_id, document_type, issuing_country, number_hmac, number_last4, recorded_by, verified_by, verified_at)
  values (p_patient_id, p_type, c, private.document_hmac(p_type, c, n), right(n, 4), p_recorded_by,
          case when p_verified then p_recorded_by end, case when p_verified then now() end)
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'This document is already registered' using errcode = '23505';
end;
$$;

-- Exact-match lookup: the caller must already hold the full number (the document is in front of them).
create or replace function private.find_patient_by_document(p_type public.identity_document_type, p_country text, p_raw text)
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.patient_id from public.patient_identity_documents d
  where d.status = 'active' and d.document_type = p_type
    and d.issuing_country = case when p_type = 'sa_id' then 'ZAF' else upper(btrim(coalesce(p_country, ''))) end
    and d.number_hmac = private.document_hmac(p_type,
          case when p_type = 'sa_id' then 'ZAF' else upper(btrim(coalesce(p_country, ''))) end,
          private.normalize_document_number(p_raw))
$$;

-- Verified replacement (correction or renewal): old row 'replaced' (history kept), new row active. Atomic.
create or replace function private.replace_identity_document(
  p_document_id uuid, p_new_raw text, p_new_country text, p_reason text, p_staff_id uuid
)
returns uuid language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  old public.patient_identity_documents;
  new_id uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if p_staff_id is null then raise exception 'Replacement must be performed by verifying staff' using errcode = '22023'; end if;
  select * into old from public.patient_identity_documents where id = p_document_id and status = 'active' for update;
  if not found then raise exception 'Active document not found'; end if;
  update public.patient_identity_documents set status = 'replaced', change_reason = btrim(p_reason) where id = old.id;
  new_id := private.register_identity_document(old.patient_id, old.document_type, coalesce(p_new_country, old.issuing_country),
                                               p_new_raw, p_staff_id, true);
  update public.patient_identity_documents set replaced_by = new_id where id = old.id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------- single-use claim codes (D-ID2)
create table public.patient_claim_codes (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.profiles(id) on delete cascade,
  code_hmac     bytea not null unique check (length(code_hmac) = 32),
  issued_by     uuid not null,        -- staff who checked the physical document before issuing
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_at   timestamptz,
  redeemed_by   uuid                  -- auth user that claimed the profile
);
create unique index patient_claim_codes_one_live on public.patient_claim_codes (patient_id) where redeemed_at is null;
alter table public.patient_claim_codes enable row level security;
revoke all on public.patient_claim_codes from public, anon, authenticated;
create policy patient_claim_codes_no_direct_access on public.patient_claim_codes
  as restrictive for all to authenticated using (false) with check (false);

-- Issue: only for a patient profile with no login and an ACTIVE, VERIFIED document. Returns the code once; only
-- its HMAC is stored. Any earlier unredeemed code for the profile is invalidated.
create or replace function private.issue_claim_code(p_patient_id uuid, p_staff_id uuid, p_ttl interval default interval '24 hours')
returns text language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare code text;
begin
  if p_staff_id is null then raise exception 'A claim code is issued by staff after a document check' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_patient_id and role = 'patient' and auth_user_id is null) then
    raise exception 'Profile cannot be claimed';
  end if;
  if not exists (select 1 from public.patient_identity_documents
                 where patient_id = p_patient_id and status = 'active' and verified_at is not null) then
    raise exception 'Verify an identity document before issuing a claim code';
  end if;
  delete from public.patient_claim_codes where patient_id = p_patient_id and redeemed_at is null;
  code := upper(encode(extensions.gen_random_bytes(10), 'hex'));   -- 80 bits
  insert into public.patient_claim_codes (patient_id, code_hmac, issued_by, expires_at)
  values (p_patient_id, extensions.hmac(convert_to('claim:' || code, 'UTF8'), private.identity_hmac_key(), 'sha256'),
          p_staff_id, now() + p_ttl);
  return code;
end;
$$;

-- Redeem: single use, unexpired, profile still unclaimed, caller has no profile yet; links the auth user. One
-- generic error for every failure. (Rate limiting of attempts belongs to the calling RPC / API layer.)
create or replace function private.redeem_claim_code(p_code text, p_auth_user_id uuid)
returns uuid language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare c public.patient_claim_codes;
begin
  select * into c from public.patient_claim_codes
   where code_hmac = extensions.hmac(convert_to('claim:' || upper(btrim(coalesce(p_code, ''))), 'UTF8'), private.identity_hmac_key(), 'sha256')
   for update;
  if not found or c.redeemed_at is not null or c.expires_at <= now()
     or exists (select 1 from public.profiles where auth_user_id = p_auth_user_id)
     or not exists (select 1 from public.profiles where id = c.patient_id and auth_user_id is null) then
    raise exception 'This claim code is not valid';
  end if;
  update public.patient_claim_codes set redeemed_at = now(), redeemed_by = p_auth_user_id where id = c.id;
  update public.profiles set auth_user_id = p_auth_user_id, updated_at = now() where id = c.patient_id;
  return c.patient_id;
end;
$$;

-- ---------------------------------------------------------------- privileges
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('normalize_document_number', 'is_valid_sa_id', 'is_valid_passport', 'identity_hmac_key',
                               'document_hmac', 'register_identity_document', 'find_patient_by_document',
                               'replace_identity_document', 'issue_claim_code', 'redeem_claim_code')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- The prototype's test driver is service_role; the key function itself is never granted.
grant execute on function private.normalize_document_number(text), private.is_valid_sa_id(text),
  private.is_valid_passport(text, text), private.register_identity_document(uuid, public.identity_document_type, text, text, uuid, boolean),
  private.find_patient_by_document(public.identity_document_type, text, text),
  private.replace_identity_document(uuid, text, text, text, uuid),
  private.issue_claim_code(uuid, uuid, interval), private.redeem_claim_code(text, uuid) to service_role;

commit;
