-- Make INR the default currency and convert any existing USD/blank profiles.
alter table public.profiles alter column currency set default 'INR';
update public.profiles set currency = 'INR' where currency is null or currency = 'USD';
