// Currency + amount formatting. Defaults to INR (₹). Falls back gracefully if the
// JS engine lacks full Intl support.
export function formatMoney(amount, currency = 'INR') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `;
    return `${symbol}${n.toFixed(2)}`;
  }
}

// Signed amount for an expense row, e.g. "+₹10.00" / "−₹5.00".
export function formatSigned(amount, currency = 'INR') {
  const n = Number(amount) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(n), currency)}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}
