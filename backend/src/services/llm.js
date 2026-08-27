import { z } from 'zod';
import { config, isLlmConfigured } from '../config.js';
import { logPersonalExpenseFromBot } from './telegramLedger.js';
import {
  listPeople,
  findExpenses,
  getSummary,
  getSettings,
  createPerson,
  createCategory,
  previewMutation,
} from './telegramTools.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function escapeHtml(s = '') {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

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

// ── tool schemas (OpenAI / Groq tool-calling dialect) ──────────────────
//
// Tools fall into three classes, and the agent loop below treats them
// differently:
//   READ      — run, feed the result back, let the model keep thinking.
//   CREATE    — run immediately and end the turn. Nothing is overwritten, so
//               there is nothing to undo and no confirmation is warranted.
//   PROPOSAL  — return a preview and end the turn. The write only happens if
//               the user taps ✅ Confirm.
//
// Everything that edits or deletes existing data is a PROPOSAL. The model can
// hallucinate an id or misread "delete the pizza one", and a wrong guess would
// otherwise silently destroy real ledger history.
//
// Descriptions are kept terse on purpose: the whole schema is resent on every
// turn of the loop, and Groq's free tier is 8k tokens/minute.

const EDITABLE_FIELDS = {
  type: 'object',
  description:
    'Fields to change. person: name, description, email, phone, whatsapp, reminders_on. ' +
    'friend_expense: amount (signed), note, date. personal_expense: amount (positive), note, date, category, payment_mode. ' +
    'category: name, icon, color.',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    whatsapp: { type: 'string' },
    reminders_on: { type: 'boolean' },
    amount: { type: 'number' },
    note: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    category: { type: 'string' },
    payment_mode: { type: 'string', enum: ['upi', 'cash', 'card', 'bank_transfer', 'other'] },
    icon: { type: 'string' },
    color: { type: 'string', description: '#rrggbb' },
  },
};

const RECORD_TYPES = ['person', 'friend_expense', 'personal_expense', 'category'];

const AGENT_TOOLS = [
  // ── READ ──
  {
    type: 'function',
    function: {
      name: 'find_expenses',
      description:
        'Search and list transactions. Covers full history, date ranges, category filters and text search. ' +
        'Returns row ids — you need one to edit or delete a row. Call with no filters for a recent overview.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['both', 'friend', 'personal'], description: 'friend = money owed by a person; personal = own spending. Default both.' },
          person: { type: 'string', description: 'Filter the friend ledger to this contact' },
          category: { type: 'string', description: 'Filter personal expenses to this category' },
          query: { type: 'string', description: 'Text to look for in the note, e.g. "pizza"' },
          from: { type: 'string', description: 'Earliest date, YYYY-MM-DD' },
          to: { type: 'string', description: 'Latest date, YYYY-MM-DD' },
          min_amount: { type: 'number' },
          max_amount: { type: 'number' },
          limit: { type: 'number', description: 'Rows per section, default 20, max 100' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_people',
      description: 'All contacts with balances, contact details and ids. Use for "who owes me", "my contacts", or to find a person id.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_summary',
      description: 'Aggregates: outstanding balances, spending totals by category and month, budget vs spent.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['balances', 'spending', 'budget', 'everything'], description: 'Default everything' },
          month: { type: 'string', description: 'YYYY-MM; omit for all time' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_settings',
      description: 'Current profile (name, currency, UPI id), reminder settings, this month\'s budget, and the category list.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // ── CREATE ──
  {
    type: 'function',
    function: {
      name: 'log_personal_expense',
      description: 'Log the user\'s own spending, when NO friend is named as owing or receiving. e.g. "spent 250 on lunch".',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Positive amount spent' },
          category: { type: 'string', description: 'Food & Dining, Shopping, Transport & Cab, Groceries, Bills & Utilities, Entertainment, Health & Medical, Travel, Education, Others' },
          note: { type: 'string', description: 'What it was for' },
          payment_mode: { type: 'string', enum: ['upi', 'cash', 'card', 'bank_transfer', 'other'] },
          date: { type: 'string', description: 'YYYY-MM-DD' },
        },
        // category and note are required: left optional the model skips them and
        // everything lands as "Uncategorised", which makes the analytics useless.
        required: ['amount', 'category', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_person',
      description: 'Add a contact with no ledger entry yet. Not needed when logging an entry — an unknown name is created on confirm.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          whatsapp: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_category',
      description: 'Create a custom spending category.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          icon: { type: 'string', description: 'MaterialIcons name' },
          color: { type: 'string', description: '#rrggbb' },
        },
        required: ['name'],
      },
    },
  },

  // ── PROPOSAL (user confirms before anything is written) ──
  {
    type: 'function',
    function: {
      name: 'propose_ledger_entries',
      description: 'Record money a friend owes or repaid. e.g. "gave Jenil 300", "Shubham +35 cold coffee", "Lakshya -362 pizza".',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                person: { type: 'string' },
                amount: { type: 'number', description: 'Signed: + they owe more, - they repaid' },
                note: { type: 'string' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
              },
              required: ['person', 'amount'],
            },
          },
          needs_clarification: { type: 'boolean' },
          clarification: { type: 'string', description: 'What to ask, if details are ambiguous' },
        },
        required: ['entries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_record',
      description:
        'Change an existing record. Get the id from find_expenses / list_people / get_settings first — never invent one. ' +
        'The user confirms before it is saved.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: RECORD_TYPES },
          id: { type: 'string', description: 'Row id from a previous lookup' },
          changes: EDITABLE_FIELDS,
        },
        required: ['type', 'id', 'changes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_record',
      description:
        'Delete a record. Get the id from a lookup first. Deleting a person also deletes all their ledger entries. ' +
        'The user confirms before it happens.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: RECORD_TYPES },
          id: { type: 'string', description: 'Row id from a previous lookup' },
        },
        required: ['type', 'id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_settings',
      description: 'Change account settings: currency, UPI id, display name, monthly budget, reminder toggles/frequency/channels, reminder email text. User confirms.',
      parameters: {
        type: 'object',
        properties: {
          currency: { type: 'string', description: '3-letter code' },
          upi_id: { type: 'string' },
          full_name: { type: 'string' },
          monthly_budget: { type: 'number', description: 'Spending limit for budget_month' },
          budget_month: { type: 'string', description: 'YYYY-MM, defaults to the current month' },
          reminders_on: { type: 'boolean' },
          reminder_frequency: { type: 'string', enum: ['weekly', 'monthly'] },
          channel_email: { type: 'boolean' },
          channel_sms: { type: 'boolean' },
          channel_whatsapp: { type: 'boolean' },
          email_subject: { type: 'string', description: 'Placeholders: {name} {lender} {total}' },
          email_message: { type: 'string' },
          email_closing: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_reminder',
      description: 'Send a payment reminder to one contact right now, over their saved email/SMS/WhatsApp. User confirms.',
      parameters: {
        type: 'object',
        properties: { person_id: { type: 'string', description: 'Contact id from list_people' } },
        required: ['person_id'],
      },
    },
  },
];

// Tools whose result must go back to the model so it can answer in words.
const READ_TOOLS = new Set(['find_expenses', 'list_people', 'get_summary', 'get_settings']);
// Tools that write immediately and end the turn.
const CREATE_TOOLS = new Set(['log_personal_expense', 'add_person', 'add_category']);

function agentSystemPrompt(peopleNames, today) {
  const roster = peopleNames.length
    ? `Contacts: ${peopleNames.join(', ')}.`
    : 'No contacts saved yet.';
  return [
    'You are the finance assistant for Pocket Police, a personal expense and friend-debt tracker.',
    'You can read, add, edit and delete everything in the user\'s account through the tools. Prefer acting over asking.',
    '',
    'Routing:',
    '- Own spending, no friend named ("spent 250 on lunch") → log_personal_expense. One call per expense: "250 on lunch and 100 on coffee" is two calls, both in the same response.',
    '- A friend owes or repaid ("gave Jenil 300", "Shubham +35 cold coffee") → propose_ledger_entries.',
    '- Shorthand "<name> -362 pizza" is a ledger entry. Pass an explicit + or - through EXACTLY as written — never flip the sign.',
    '- A question ("how much does X owe", "what did I spend on food in July", "show all transactions") → look it up with a read tool, then answer in plain words with real numbers.',
    '- "settled up" / "paid back everything" → look up the balance first, then propose the opposite amount.',
    '',
    'Editing and deleting:',
    '- Always look the record up first to get its id. Never guess or reuse an id from memory.',
    '- edit_record, delete_record, update_settings and send_reminder do NOT write anything themselves — they show the user a preview with Confirm and Cancel buttons. So call the tool. Never ask for permission in words first, never describe the change and wait, and never print a record id.',
    '- If exactly one record matches what the user described, act on it. Only list the options and ask when two or more genuinely match.',
    '',
    'Answering:',
    '- Be brief and concrete. Give totals and dates, not a restatement of the question.',
    '- Plain text only — no markdown, no asterisks, no tables. Bullet lines starting with • are fine.',
    '- Never invent a number. If a lookup returns nothing, say so.',
    `- ${roster} Spell a contact's name exactly as listed there; do not retype it from the user's message.`,
    `- Today is ${today}.`,
  ].join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One chat-completions call. Groq's free tier is 8k tokens/min and the agent
// loop can burn several turns per user message, so a 429 gets a couple of short
// retries instead of surfacing as "I couldn't process that".
async function groqChat(messages, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.groqApiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.groqModel,
        temperature: 0,
        tools: AGENT_TOOLS,
        tool_choice: 'auto',
        messages,
      }),
    });

    if (res.ok) return res.json();

    const body = await res.text().catch(() => '');

    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 8000)
        : 1500 * (attempt + 1);
      console.warn(`[llm] Groq rate limited, retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const err = new Error(
      `Groq request failed (${res.status}) for model "${config.llm.groqModel}": ${body.slice(0, 300)}`,
    );
    // Groq retires models; a decommissioned GROQ_MODEL 404s on every single
    // turn, so surface it as a config problem instead of a transient blip.
    if (res.status === 404 || body.includes('model_not_found')) err.code = 'LLM_MODEL_UNAVAILABLE';
    if (res.status === 429) err.code = 'LLM_RATE_LIMITED';
    throw err;
  }
}

// Maps a record type from the tool call onto a mutation understood by
// telegramTools. Keeping the model's vocabulary separate from the storage
// layout means a schema change doesn't require reprompting.
function toMutation(name, args) {
  const editing = name === 'edit_record';
  switch (args.type) {
    case 'person':
      return editing
        ? { kind: 'update_person', id: args.id, changes: args.changes }
        : { kind: 'delete_person', id: args.id };
    case 'category':
      return editing
        ? { kind: 'update_category', id: args.id, changes: args.changes }
        : { kind: 'delete_category', id: args.id };
    case 'friend_expense':
    case 'personal_expense': {
      const scope = args.type === 'personal_expense' ? 'personal' : 'friend';
      return editing
        ? { kind: 'update_expense', scope, id: args.id, changes: args.changes }
        : { kind: 'delete_expense', scope, id: args.id };
    }
    default:
      return null;
  }
}

async function runReadTool(userId, name, args) {
  switch (name) {
    case 'find_expenses': return findExpenses(userId, args);
    case 'list_people': return listPeople(userId);
    case 'get_summary': return getSummary(userId, args);
    case 'get_settings': return getSettings(userId);
    default: return { error: `Unknown read tool: ${name}` };
  }
}

// Runs a create and returns both the tool result (for the model, if the loop
// continues) and a ready-to-send line (if it doesn't).
async function runCreateTool(userId, name, args) {
  if (name === 'log_personal_expense') {
    const r = await logPersonalExpenseFromBot(userId, args);
    return {
      result: r,
      line: `✅ Logged <b>${escapeHtml(r.formatted_amount)}</b> — ${escapeHtml(r.note)} (${escapeHtml(r.category)})`,
    };
  }
  if (name === 'add_person') {
    const r = await createPerson(userId, args);
    return {
      result: r,
      line: r.created
        ? `✅ Added <b>${escapeHtml(r.name)}</b> to your contacts.`
        : `<b>${escapeHtml(r.name)}</b> is already in your contacts.`,
    };
  }
  const r = await createCategory(userId, args);
  return {
    result: r,
    line: r.created
      ? `✅ Created category <b>${escapeHtml(r.name)}</b>.`
      : `Category <b>${escapeHtml(r.name)}</b> already exists.`,
  };
}

// ReAct agent loop. Returns one of:
//   { type: 'text', text }                    — answer to send as-is (HTML-safe)
//   { type: 'propose_entries', result }       — ledger entries awaiting confirm
//   { type: 'confirm', action, previewHtml }  — a mutation awaiting confirm
export async function runAgentLoop({ text, history = [], peopleNames = [], today, userId }) {
  if (!isLlmConfigured()) {
    const e = new Error('LLM is not configured');
    e.code = 'LLM_NOT_CONFIGURED';
    throw e;
  }

  const historyMessages = (history || []).map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: String(h.content || ''),
  }));

  const messages = [
    { role: 'system', content: agentSystemPrompt(peopleNames, today) },
    ...historyMessages,
    { role: 'user', content: text },
  ];

  const maxTurns = 5;
  const createdLines = [];

  for (let turns = 0; turns < maxTurns; turns++) {
    const data = await groqChat(messages);
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('Groq returned an empty response');

    const toolCalls = message.tool_calls;
    if (!toolCalls?.length) {
      // No tool call -> the model answered directly. Telegram sends with
      // parse_mode HTML, so escape it: a stray "<" makes the whole send 400.
      if (message.content) return { type: 'text', text: escapeHtml(message.content.trim()) };
      break;
    }

    messages.push(message);

    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }

      // ── terminal proposals: nothing else in the batch matters ──
      if (name === 'propose_ledger_entries') {
        return { type: 'propose_entries', result: extractionSchema.parse(args) };
      }
      if (name === 'edit_record' || name === 'delete_record' || name === 'update_settings' || name === 'send_reminder') {
        const action =
          name === 'update_settings' ? { kind: 'update_settings', changes: args }
          : name === 'send_reminder' ? { kind: 'send_reminder', id: args.person_id }
          : toMutation(name, args);

        if (!action) {
          messages.push(toolMessage(call, { error: `Unknown record type "${args.type}".` }));
          continue;
        }
        try {
          const { action: checked, previewHtml } = await previewMutation(userId, action);
          return { type: 'confirm', action: checked, previewHtml };
        } catch (e) {
          // A rejected proposal (bad id, empty change set, nothing owed) is
          // information for the model, not a dead end — let it retry or explain.
          if (e.code !== 'TOOL_BAD_REQUEST') throw e;
          messages.push(toolMessage(call, { error: e.message }));
          continue;
        }
      }

      // ── reads and creates ──
      try {
        if (READ_TOOLS.has(name)) {
          messages.push(toolMessage(call, await runReadTool(userId, name, args)));
        } else if (CREATE_TOOLS.has(name)) {
          const { result, line } = await runCreateTool(userId, name, args);
          createdLines.push(line);
          messages.push(toolMessage(call, result));
        } else {
          messages.push(toolMessage(call, { error: `Unknown tool: ${name}` }));
        }
      } catch (e) {
        if (e.code !== 'TOOL_BAD_REQUEST') throw e;
        messages.push(toolMessage(call, { error: e.message }));
      }
    }

  }

  // Loop exhausted. If writes did land, report them rather than pretending
  // nothing happened.
  if (createdLines.length) return { type: 'text', text: createdLines.join('\n') };
  return { type: 'text', text: 'I ran out of steps working that one out. Try rephrasing it?' };
}

function toolMessage(call, payload) {
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) };
}

// Fallback single-shot extractor kept for backwards compatibility
export async function extractEntries(text, options = {}) {
  const result = await runAgentLoop({ text, ...options });
  if (result.type === 'propose_entries') {
    return result.result;
  }
  return { entries: [], needs_clarification: false, clarification: null };
}
