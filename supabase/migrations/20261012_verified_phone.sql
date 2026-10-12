-- Phone registration, confirmed by Telegram.
--
-- A seller registers by tapping "Share my phone number"; Telegram sends the
-- number attached to THEIR account, so it cannot be typed or faked. It is
-- stored on the channel (this Telegram account -> this shop), not on
-- businesses.phone: that column is the shop phone printed on customer bills,
-- and the owner's private number must never end up there.
--
-- Run once: Supabase dashboard -> SQL Editor -> paste -> Run.

alter table business_channels add column if not exists verified_phone text;
alter table business_channels add column if not exists phone_verified_at timestamptz;
