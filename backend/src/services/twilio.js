import twilio from 'twilio';
import { config, isTwilioConfigured } from '../config.js';

let client = null;
if (isTwilioConfigured()) {
  client = twilio(config.twilio.accountSid, config.twilio.authToken);
}

function buildMessage({ personName, lenderName, amountText, upiId }) {
  let msg = `Hi ${personName}, this is a reminder that you owe ${lenderName} ${amountText}. Please clear it when you can.`;
  if (upiId) msg += ` Pay via UPI: ${upiId}`;
  msg += ` — via Pocket Police`;
  return msg;
}

// Sends an SMS. Returns { id } (Twilio message SID).
export async function sendReminderSms({ to, personName, lenderName, amountText, upiId }) {
  if (!client) throw new Error('Twilio not configured');
  if (!config.twilio.smsFrom) throw new Error('TWILIO_SMS_FROM not set');

  const body = buildMessage({ personName, lenderName: lenderName || 'ek dost', amountText, upiId });
  const msg = await client.messages.create({ from: config.twilio.smsFrom, to, body });
  return { id: msg.sid };
}

// Sends a WhatsApp message. NOTE: WhatsApp requires an approved template for
// business-initiated messages. For a free-form body to work, the recipient must
// have messaged you within the last 24h, or use the Twilio WhatsApp sandbox.
export async function sendReminderWhatsApp({ to, personName, lenderName, amountText, upiId }) {
  if (!client) throw new Error('Twilio not configured');
  if (!config.twilio.whatsappFrom) throw new Error('TWILIO_WHATSAPP_FROM not set');

  const toAddr = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const body = buildMessage({ personName, lenderName: lenderName || 'ek dost', amountText, upiId });
  const msg = await client.messages.create({ from: config.twilio.whatsappFrom, to: toAddr, body });
  return { id: msg.sid };
}
