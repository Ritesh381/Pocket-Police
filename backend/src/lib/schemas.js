import { z } from 'zod';

const emptyToNull = (v) => (v === '' ? null : v);

export const personCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).nullish().transform(emptyToNull),
  email: z.string().trim().email('Invalid email').nullish().or(z.literal('')).transform(emptyToNull),
  phone: z.string().trim().max(30).nullish().transform(emptyToNull),
  whatsapp: z.string().trim().max(30).nullish().transform(emptyToNull),
  reminders_on: z.boolean().optional(),
});

// All fields optional for PATCH, but at least one must be present.
export const personUpdateSchema = personCreateSchema.partial().refine(
  (obj) => Object.keys(obj).length > 0,
  { message: 'No fields to update' },
);

export const expenseCreateSchema = z.object({
  amount: z.coerce.number().finite().refine((n) => n !== 0, 'Amount cannot be zero'),
  note: z.string().trim().max(500).nullish().transform(emptyToNull),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});

export const expenseUpdateSchema = expenseCreateSchema.partial().refine(
  (obj) => Object.keys(obj).length > 0,
  { message: 'No fields to update' },
);

export const settingsUpdateSchema = z.object({
  reminders_on: z.boolean().optional(),
  reminder_frequency: z.enum(['monthly', 'weekly']).optional(),
  channel_email: z.boolean().optional(),
  channel_sms: z.boolean().optional(),
  channel_whatsapp: z.boolean().optional(),
  // Custom email text. Placeholders: {name} {lender} {total}. Null = use defaults.
  email_subject: z.string().trim().max(200).nullish().transform(emptyToNull),
  email_message: z.string().trim().max(2000).nullish().transform(emptyToNull),
  email_closing: z.string().trim().max(1000).nullish().transform(emptyToNull),
}).refine((obj) => Object.keys(obj).length > 0, { message: 'No fields to update' });

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().max(120).optional(),
  currency: z.string().trim().length(3, 'Use a 3-letter currency code').optional(),
  upi_id: z.string().trim().max(100).nullish().transform((v) => (v === '' ? null : v)),
}).refine((obj) => Object.keys(obj).length > 0, { message: 'No fields to update' });
