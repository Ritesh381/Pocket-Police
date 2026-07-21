import nodemailer from 'nodemailer';
import { config, isEmailConfigured } from '../config.js';

// SMTP transport (Gmail / Google Workspace / any SMTP server). Created lazily and
// reused across sends.
let transporter = null;
function getTransporter() {
  if (!isEmailConfigured()) throw new Error('Email not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing)');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpSecure, // true = 465, false = 587 (STARTTLS)
      auth: { user: config.email.smtpUser, pass: config.email.smtpPass },
    });
  }
  return transporter;
}

// Verifies the SMTP connection/credentials without sending. Handy for setup.
export async function verifyEmail() {
  return getTransporter().verify();
}

function money(amount, currency = 'INR') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `;
    return `${sym}${n.toFixed(2)}`;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

// Builds a UPI deep link (opens any UPI app with amount prefilled).
function upiLink({ upiId, payeeName, amount, note }) {
  const p = new URLSearchParams({
    pa: upiId,
    pn: payeeName || 'Pocket Police',
    am: (Number(amount) || 0).toFixed(2),
    cu: 'INR',
    tn: note || 'Pocket Police reminder',
  });
  return `upi://pay?${p.toString()}`;
}

// Hosted QR image for a UPI link. Email clients strip `upi://` <a> links, so a
// scannable QR is the reliable way to pay from an email — any UPI app / camera
// reads it and opens payment with the amount prefilled.
function upiQrImageUrl(link) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(link)}`;
}

// Default email text (placeholders: {name} {lender} {total}).
export const EMAIL_DEFAULTS = {
  subject: 'Reminder: you owe {lender} {total}',
  message: "Hi {name},\nThis is a reminder that you owe {lender} {total}. Here's the breakdown:",
  closing: 'Please clear it whenever you can.',
};

function applyPlaceholders(str, vars) {
  return String(str)
    .replaceAll('{name}', vars.name)
    .replaceAll('{lender}', vars.lender)
    .replaceAll('{total}', vars.total);
}

// Escapes HTML and turns newlines into <br> for safe rendering of user text.
function textToHtml(str) {
  return escapeHtml(str).replaceAll('\n', '<br/>');
}

// Sends the Pocket Police reminder email. Returns { id } (messageId).
// data: { to, personName, lenderName, balance, currency, expenses[], upiId, template }
export async function sendReminderEmail(data) {
  const tx = getTransporter();
  const {
    to,
    personName = 'there',
    lenderName = 'a friend',
    balance = 0,
    currency = 'INR',
    expenses = [],
    upiId = null,
    template = {},
  } = data;

  const totalText = money(balance, currency);
  const vars = { name: personName, lender: lenderName, total: totalText };
  const subjectText = applyPlaceholders(template.subject || EMAIL_DEFAULTS.subject, vars);
  const messageHtml = textToHtml(applyPlaceholders(template.message || EMAIL_DEFAULTS.message, vars));
  const closingHtml = textToHtml(applyPlaceholders(template.closing || EMAIL_DEFAULTS.closing, vars));

  // ── History rows ──
  const rows = (expenses || [])
    .map((e) => {
      const amt = Number(e.amount);
      const color = amt > 0 ? '#0B7A4B' : '#DC2626';
      const sign = amt > 0 ? '+' : '−';
      return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;color:#555;font-size:13px;">${fmtDate(e.incurred_on)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;color:#222;font-size:14px;">${escapeHtml(e.note || (amt > 0 ? 'Udhaar' : 'Wapas kiya'))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;color:${color};font-size:14px;font-weight:700;text-align:right;white-space:nowrap;">${sign}${money(Math.abs(amt), currency)}</td>
      </tr>`;
    })
    .join('');

  const historyTable = `
    <table style="width:100%;border-collapse:collapse;margin:8px 0 4px;border:1px solid #EEE;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#F5F6F8;">
          <th style="padding:8px 10px;text-align:left;font-size:12px;color:#888;text-transform:uppercase;">Date</th>
          <th style="padding:8px 10px;text-align:left;font-size:12px;color:#888;text-transform:uppercase;">Note</th>
          <th style="padding:8px 10px;text-align:right;font-size:12px;color:#888;text-transform:uppercase;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="3" style="padding:12px;color:#888;font-size:13px;">No entries.</td></tr>`}</tbody>
    </table>`;

  // ── UPI pay block: QR (reliable) + copy-paste ID. No <a> button — email
  //    clients strip upi:// links. ──
  const link = upiId ? upiLink({ upiId, payeeName: lenderName, amount: balance, note: `Payment to ${lenderName}` }) : null;
  const payBlock = link
    ? `
      <div style="margin:20px 0 6px;padding:16px;border:1px solid #EEE;border-radius:10px;text-align:center;">
        <p style="font-size:14px;color:#333;margin:0 0 10px;font-weight:600;">Pay ${escapeHtml(lenderName)} via UPI</p>
        <img src="${upiQrImageUrl(link)}" alt="Scan to pay ${totalText}" width="200" height="200" style="display:block;margin:0 auto;border-radius:8px;" />
        <p style="font-size:13px;color:#666;margin:10px 0 0;">Scan with any UPI app (amount ${totalText} prefilled)</p>
        <p style="font-size:14px;color:#333;margin:8px 0 0;">or send to UPI ID: <strong style="color:#0B7A4B;">${escapeHtml(upiId)}</strong></p>
      </div>`
    : '';

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;padding:8px;">
    <div style="background:#0B7A4B;border-radius:14px;padding:20px;color:#fff;">
      <div style="font-size:26px;">🧾</div>
      <div style="font-size:19px;font-weight:800;margin-top:4px;">Payment reminder</div>
    </div>

    <div style="padding:20px 4px;">
      <p style="font-size:16px;line-height:1.6;margin:0 0 8px;">${messageHtml}</p>

      <h3 style="font-size:14px;color:#333;margin:22px 0 6px;">History</h3>
      ${historyTable}

      <div style="text-align:right;margin-top:10px;font-size:16px;">
        <span style="color:#666;">Total:</span>
        <strong style="color:#0B7A4B;font-size:20px;">&nbsp;${totalText}</strong>
      </div>

      ${payBlock}

      <p style="font-size:15px;line-height:1.6;margin:22px 0 0;color:#333;">${closingHtml}</p>
    </div>

    <div style="border-top:1px solid #EEE;padding-top:12px;text-align:center;">
      <p style="font-size:12px;color:#aaa;margin:0;">Sent via Pocket Police 🧾</p>
    </div>
  </div>`;

  const info = await tx.sendMail({ from: config.email.from, to, subject: subjectText, html });
  return { id: info.messageId };
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
