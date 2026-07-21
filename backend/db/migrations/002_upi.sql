-- Adds the lender's UPI ID (VPA) so reminder emails can include a pay link.
alter table public.profiles add column if not exists upi_id text;
