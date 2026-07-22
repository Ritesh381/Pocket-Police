-- Users pick EITHER weekly OR monthly reminders (default monthly).
alter table public.reminder_settings add column if not exists reminder_frequency text not null default 'monthly';
alter table public.reminder_settings drop constraint if exists reminder_settings_frequency_chk;
alter table public.reminder_settings add constraint reminder_settings_frequency_chk
  check (reminder_frequency in ('monthly', 'weekly'));
