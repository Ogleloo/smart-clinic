-- Migration 0035: describe what each service actually covers.
--
-- Found during competitor review (Clicks Clinics): patients cannot choose
-- correctly between services named only "General Consultation" or
-- "Immunization". A patient who needs family planning has no way to know
-- which queue that falls under, so they join the wrong one, wait, and are
-- redirected — which is worse than the paper system they replaced.
--
-- DELIBERATELY a description, NOT more services. Each service is a
-- separate queue with its own consultation history, and the confidence
-- label is computed per service from sample count and variance. Splitting
-- three services into twelve would quarter the evidence behind every
-- estimate and push confidence toward Low everywhere. Naming granularity
-- and queue granularity are different concerns: describe richly, queue
-- coarsely.

alter table public.services
  add column if not exists description text,
  add column if not exists includes text[];

update public.services set
  description = 'Everyday illness, injuries, and ongoing conditions. '
                'Start here if you are unsure which service you need.',
  includes = array[
    'Minor ailments (flu, sore throat, rashes)',
    'Blood pressure, glucose and cholesterol checks',
    'Chronic condition follow-up',
    'HIV counselling and testing',
    'Family planning consultation',
    'Wound care and dressings',
    'Referral to a hospital or specialist']
where token_prefix = 'GC';

update public.services set
  description = 'Routine vaccinations for children and adults, and '
                'child growth monitoring.',
  includes = array[
    'Childhood immunisation schedule',
    'Baby wellness and growth monitoring',
    'Adult and travel vaccinations',
    'Tetanus after an injury']
where token_prefix = 'IM';

update public.services set
  description = 'Collect medicine you have already been prescribed. '
                'You do not need to see a nurse first.',
  includes = array[
    'Repeat chronic medication collection',
    'Medicine prescribed at today''s visit',
    'Advice on how to take your medicine']
where token_prefix = 'PH';

notify pgrst, 'reload schema';
