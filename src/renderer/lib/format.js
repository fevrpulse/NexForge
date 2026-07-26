export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function maskAccount(num) {
  const s = String(num || '');
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

export function formatPrizeLabel(t) {
  const parts = [];
  if ((t.prize_type === 'cash' || t.prize_type === 'both') && t.cash_amount) {
    parts.push('$' + Number(t.cash_amount).toLocaleString());
  }
  if (t.prize_type === 'inapp' || t.prize_type === 'both') {
    parts.push(t.inapp_reward ? 'In-App' : 'Reward');
  }
  return parts.join(' + ') || 'Prize TBD';
}
