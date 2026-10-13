-- Onboarding asks the owner's name, the shop phone and the city/area.
--
-- owner_name: the seller's own name (the shop name is businesses.name).
-- Shop phone and area already have columns (businesses.phone, .address).
-- The setup step list gains 'owner', 'phone' and 'area'.
--
-- Until this runs, the bot keeps the old 3-question setup — nothing breaks.
-- Run once: Supabase dashboard -> SQL Editor -> paste -> Run.

alter table businesses add column if not exists owner_name text;

alter table businesses drop constraint if exists businesses_onboarding_step_check;
alter table businesses add constraint businesses_onboarding_step_check
  check (onboarding_step is null or onboarding_step in ('kind', 'owner', 'name', 'phone', 'area', 'prices', 'done'));
