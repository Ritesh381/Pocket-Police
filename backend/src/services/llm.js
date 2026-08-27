import { z } from 'zod';
import { config, isLlmConfigured } from '../config.js';
import {
  getPersonBalanceByName,
  listAllBalances,
  getExpenseHistoryByName,
  logPersonalExpenseFromBot,
} from './telegramLedger.js';

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

// Tool schemas for OpenAI / Groq tool calling
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'log_personal_expense',
      description: 'Logs a personal spending expense (e.g. "spent 250 on lunch", "bought groceries for 1200", "paid 500 for uber"). Use this when NO friend name is mentioned as receiving or owing money.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Positive amount spent' },
          category: { type: 'string', description: 'Inferred category: Food & Dining, Shopping, Transport & Cab, Groceries, Bills & Utilities, Entertainment, Health & Medical, Travel, Education, or Others' },
          note: { type: 'string', description: 'Short note/description of what was bought' },
          payment_mode: { type: 'string', enum: ['upi', 'cash', 'card', 'bank_transfer', 'other'], description: 'Payment mode if mentioned (default upi)' },
          date: { type: 'string', description: 'YYYY-MM-DD date if specified' },
        },
        required: ['amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_person_balance',
      description: "Looks up a person's current balance and contact record by name. Use this when the user mentions someone paying back 'all' their debt or asks what someone owes.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the person to look up' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_all_balances',
      description: 'Lists all debtors and their current balances for this user. Use when asked "who owes me money" or "total debt" or "show all balances".',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expense_history',
      description: 'Fetches recent expense transactions for a specific person.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the person' },
          limit: { type: 'number', description: 'Number of recent items (default 5)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_ledger_entries',
      description: 'Proposes one or more debt/credit entries for a friend to be recorded to the ledger after confirmation.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                person: { type: 'string', description: 'Name of person' },
                amount: { type: 'number', description: 'Signed amount (+ for lent/took, - for repaid/returned)' },
                note: { type: 'string', description: 'Optional description of what the money was for' },
                date: { type: 'string', description: 'YYYY-MM-DD date if specified' },
              },
              required: ['person', 'amount'],
            },
          },
          needs_clarification: { type: 'boolean', description: 'True if details are still ambiguous' },
          clarification: { type: 'string', description: 'Question to ask the user if clarification is needed' },
        },
        required: ['entries'],
      },
    },
  },
];

function agentSystemPrompt(peopleNames, today) {
  const roster = peopleNames.length
    ? `Existing contacts: ${peopleNames.join(', ')}.`
    : 'No contacts saved yet.';
  return [
    'You are the intelligent finance & debt assistant for Pocket Police.',
    'Your goal is to help the user log personal spending, manage friend debts, or answer balance queries.',
    '',
    'Tool Usage Rules:',
    '- If the user logs personal spending (e.g. "spent 250 on lunch", "paid 500 for cab", "bought shirt for 1200"), call `log_personal_expense`. Do NOT ask for confirmation.',
    '- If a friend/person is mentioned as borrowing, taking, or returning money (e.g. "gave Jenil 300", "Ritesh returned 150"), call `propose_ledger_entries`.',
    '- Shorthand like "Lakshya -362 pizza" or "Shubham +35 cold coffee" is a ledger entry. When the user writes an explicit + or - in front of the amount, pass that sign through EXACTLY as written — never flip it.',
    '- If the user says a person "paid back all their money" or "settled up", call `get_person_balance(name)` first to look up their balance, then call `propose_ledger_entries` with amount = -balance.',
    '- If the user asks a question about balances (e.g. "how much does X owe?", "who owes me money?"), use `get_person_balance` or `list_all_balances` to check, then answer in clear text.',
    `- ${roster}`,
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

// ReAct Agent Loop: runs up to `maxTurns` tool iterations with Groq.
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

  let turns = 0;
  const maxTurns = 5;

  while (turns < maxTurns) {
    turns++;
    const data = await groqChat(messages);
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('Groq returned an empty response');

    const toolCalls = message.tool_calls;

    // If the model called a tool:
    if (toolCalls && toolCalls.length > 0) {
      messages.push(message); // Add assistant tool_calls message

      for (const call of toolCalls) {
        const fnName = call.function?.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(call.function?.arguments || '{}');
        } catch {
          fnArgs = {};
        }

        // If the model called `propose_ledger_entries`, we finish the agent loop!
        if (fnName === 'propose_ledger_entries') {
          const parsed = extractionSchema.parse(fnArgs);
          return { type: 'propose_entries', result: parsed };
        }

        // Execute DB tool
        let toolOutput;
        if (fnName === 'log_personal_expense') {
          toolOutput = await logPersonalExpenseFromBot(userId, fnArgs);
          return {
            type: 'text',
            text: `✅ Logged personal expense: <b>${escapeHtml(toolOutput.formatted_amount)}</b> for ${escapeHtml(toolOutput.note)} (${escapeHtml(toolOutput.category)})`,
          };
        } else if (fnName === 'get_person_balance') {
          toolOutput = await getPersonBalanceByName(userId, fnArgs.name);
        } else if (fnName === 'list_all_balances') {
          toolOutput = await listAllBalances(userId);
        } else if (fnName === 'get_expense_history') {
          toolOutput = await getExpenseHistoryByName(userId, fnArgs.name, fnArgs.limit || 5);
        } else {
          toolOutput = { error: `Unknown tool: ${fnName}` };
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(toolOutput),
        });
      }

      // Loop continues so LLM processes the tool outputs!
      continue;
    }

    // No tool call -> model returned a direct text response. Telegram sends with
    // parse_mode HTML, so escape it — a stray "<" makes the whole send 400.
    if (message.content) {
      return { type: 'text', text: escapeHtml(message.content.trim()) };
    }

    break;
  }

  // Fallback if loop ends without explicit proposal or text
  return { type: 'text', text: "I processed your request. Is there anything else you need?" };
}

// Fallback single-shot extractor kept for backwards compatibility
export async function extractEntries(text, options = {}) {
  const result = await runAgentLoop({ text, ...options });
  if (result.type === 'propose_entries') {
    return result.result;
  }
  return { entries: [], needs_clarification: false, clarification: null };
}
