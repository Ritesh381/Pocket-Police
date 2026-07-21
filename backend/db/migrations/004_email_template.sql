-- Lets each user customize the reminder email text.
-- Placeholders supported in these fields: {name} {lender} {total}
alter table public.reminder_settings add column if not exists email_subject text;
alter table public.reminder_settings add column if not exists email_message text;
alter table public.reminder_settings add column if not exists email_closing text;
