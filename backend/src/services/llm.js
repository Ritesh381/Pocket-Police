// LLM adapter for the Telegram bot. Turns a plain-language message into
// STRUCTURED ledger entries — never SQL (see TELEGRAM_BOT_PLAN.md §0).
//
// Provider: Groq (OpenAI-compatible chat completions, JSON mode). Swapping to a
// different provider later is a one-file change — keep the `extractEntries`
// signature stable.
import { z } from 'zod';
import { config, isLlmConfigured } from '../config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// What the model must return. `amount` is SIGNED, matching the app's convention:
//   positive = the person received money / owes more
//   negative = the person paid you back
const extractionSchema = z.object({
  entries: z
    .array(
      z.object({
        person: z.string().trim().min(1),
        amount: z.number().finite().refine((n) => n !== 0, 'amount cannot be zero'),
        note: z.string().trim().max(200).nullish(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
      }),
    )
    .default([]),
  needs_clarification: z.boolean().default(false),
  clarification: z.string().nullish(),
});

function systemPrompt(peopleNames, today) {
  const roster = peopleNames.length
    ? `The user already tracks these people (match names to them, case-insensitive, allowing small typos): ${peopleNames.join(', ')}.`
    : 'The user has no people saved yet.';
  return [
    'You extract debt-ledger entries from a short message written by the user of a personal debt tracker.',
    'You output ONLY a JSON object — no prose. Shape:',
    '{ "entries": [ { "person": string, "amount": number, "note": string|null, "date": "YYYY-MM-DD"|null } ], "needs_clarification": boolean, "clarification": string|null }',
    '',
    'Rules:',
    '- "amount" is SIGNED. Positive = the person received money from the user / now owes more (e.g. "gave Jenil 300", "Jenil took 500", "lent Aman 200"). Negative = the person paid the user back / owes less (e.g. "Jenil paid back 100", "Shubham returned 50").',
    '- Split a multi-person or multi-item message into one entry per person per item.',
    '- "note" is a short description of what the money was for (e.g. "dinner", "cab"). Null if none.',
    '- "date" only if the message clearly states one; otherwise null. Resolve relative dates against today.',
    '- Never invent amounts or people. If an amount or who-owes-whom is ambiguous, set needs_clarification=true and put a short question in "clarification", with entries=[].',
    `- ${roster}`,
    `- Today is ${today}.`,
  ].join('\n');
}

// Extracts entries from `text`. Returns the validated object, or throws on
// transport / parse failure so the caller can show a friendly error.
export async function extractEntries(text, { peopleNames = [], today, history = [] } = {}) {
  if (!isLlmConfigured()) {
    const e = new Error('LLM is not configured');
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }

  const historyMessages = (history || []).map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: String(h.content || ''),
  }));

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.groqModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt(peopleNames, today) },
        ...historyMessages,
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned an empty response');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Groq did not return valid JSON');
  }
  return extractionSchema.parse(parsed);
}
