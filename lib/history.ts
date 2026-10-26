// Secrets this browser has sent, kept only on this device so the dashboard can
// show whether each one was opened. Never stores the link, key or content.

const HISTORY_KEY = 'onepass.sent';
const MAX_ITEMS = 100;

export type SentSecret = {
  id: string;
  type: 'text' | 'file';
  size?: number;
  timer?: number;
  createdAt: number; // ms
  expiresAt: number; // ms
};

export function getHistory(): SentSecret[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(x => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
}

export function addToHistory(item: SentSecret) {
  try {
    const list = [item, ...getHistory().filter(x => x.id !== item.id)].slice(0, MAX_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch { /* storage unavailable */ }
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}
