import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { personCreateSchema, personUpdateSchema, expenseCreateSchema } from '../lib/schemas.js';
import { remindPerson } from '../services/reminders.js';

const router = Router();

// POST /api/people/:id/remind — send a reminder to this person right now.
router.post('/:id/remind', asyncHandler(async (req, res) => {
  const summary = await remindPerson(req.params.id, req.user.id);
  res.json({ ok: true, summary });
}));

// GET /api/people — list all people for the user, each with a computed balance.
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [{ data: people, error: peopleErr }, { data: balances, error: balErr }] =
    await Promise.all([
      supabase.from('people').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('person_balances').select('person_id, balance').eq('user_id', userId),
    ]);

  if (peopleErr) throw supabaseError(peopleErr);
  if (balErr) throw supabaseError(balErr);

  const balanceById = new Map((balances || []).map((b) => [b.person_id, Number(b.balance)]));
  const enriched = (people || []).map((p) => ({ ...p, balance: balanceById.get(p.id) ?? 0 }));
  // Highest balance (most owed) first.
  enriched.sort((a, b) => b.balance - a.balance);

  res.json({ people: enriched });
}));

// POST /api/people — add a person.
router.post('/', asyncHandler(async (req, res) => {
  const input = parseBody(personCreateSchema, req.body);
  const { data, error } = await supabase
    .from('people')
    .insert({ ...input, user_id: req.user.id })
    .select()
    .single();
  if (error) throw supabaseError(error);
  res.status(201).json({ person: { ...data, balance: 0 } });
}));

// GET /api/people/:id — one person with balance.
router.get('/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data: person, error } = await supabase
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .eq('id', req.params.id)
    .single();
  if (error) throw supabaseError(error, 'Person not found');

  const { data: bal } = await supabase
    .from('person_balances')
    .select('balance')
    .eq('person_id', person.id)
    .maybeSingle();

  res.json({ person: { ...person, balance: Number(bal?.balance ?? 0) } });
}));

// PATCH /api/people/:id — update a person.
router.patch('/:id', asyncHandler(async (req, res) => {
  const input = parseBody(personUpdateSchema, req.body);
  const { data, error } = await supabase
    .from('people')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw supabaseError(error, 'Person not found');
  res.json({ person: data });
}));

// DELETE /api/people/:id — delete a person (expenses cascade in the DB).
router.delete('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('people')
    .delete()
    .eq('user_id', req.user.id)
    .eq('id', req.params.id)
    .select('id')
    .single();
  if (error) throw supabaseError(error, 'Person not found');
  res.json({ deleted: data.id });
}));

// GET /api/people/:id/expenses — ledger for a person (with running balance).
router.get('/:id/expenses', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Ownership check.
  const { error: ownErr } = await supabase
    .from('people').select('id').eq('user_id', userId).eq('id', req.params.id).single();
  if (ownErr) throw supabaseError(ownErr, 'Person not found');

  const { data: expenses, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .eq('person_id', req.params.id)
    .order('incurred_on', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw supabaseError(error);

  // Attach a running balance to each entry.
  let running = 0;
  const withRunning = expenses.map((e) => {
    running += Number(e.amount);
    return { ...e, running_balance: Number(running.toFixed(2)) };
  });

  res.json({ expenses: withRunning, balance: Number(running.toFixed(2)) });
}));

// POST /api/people/:id/expenses — add an expense under a person.
router.post('/:id/expenses', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const input = parseBody(expenseCreateSchema, req.body);

  // Ownership check.
  const { error: ownErr } = await supabase
    .from('people').select('id').eq('user_id', userId).eq('id', req.params.id).single();
  if (ownErr) throw supabaseError(ownErr, 'Person not found');

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      person_id: req.params.id,
      user_id: userId, // also set by DB trigger; harmless to set here too
      amount: input.amount,
      note: input.note ?? null,
      ...(input.incurred_on ? { incurred_on: input.incurred_on } : {}),
    })
    .select()
    .single();
  if (error) throw supabaseError(error);
  res.status(201).json({ expense: data });
}));

export default router;
