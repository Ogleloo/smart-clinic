-- Migration 0053: human-readable appointment reference numbers.
--
-- Format: AP-YYYYMMDD-NNNN where NNNN is a daily sequence.
-- Generated on insert by a trigger, so the application never constructs one.

alter table public.appointments
  add column if not exists reference text;

create or replace function public.generate_appointment_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  seq int;
begin
  select count(*) + 1 into seq
  from public.appointments
  where scheduled_date = new.scheduled_date
    and reference is not null;

  new.reference := 'AP-' || to_char(new.scheduled_date, 'YYYYMMDD') || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_appointment_reference on public.appointments;
create trigger trg_appointment_reference
  before insert on public.appointments
  for each row
  when (new.reference is null)
  execute function public.generate_appointment_reference();

-- backfill existing appointments using a CTE
with numbered as (
  select id,
         'AP-' || to_char(scheduled_date, 'YYYYMMDD') || '-' ||
           lpad((row_number() over (partition by scheduled_date order by created_at))::text, 4, '0') as ref
  from public.appointments
  where reference is null
)
update public.appointments a
set reference = n.ref
from numbered n
where a.id = n.id;

notify pgrst, 'reload schema';
