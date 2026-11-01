// "Report chat": tells OnePeek that a room needs a look. Only two things leave the phone, the room
// id and a reason word; no message, name, file or key is read, and nothing here can read them
// anyway (the core never hands plaintext to this module). The call is authenticated with the
// current session's bearer so the backend can tell which member reported (B5: POST /api/chat/report).
import * as chatLib from './chat';
import { getChat } from './chat';

/** `getSupabase()` lands with core-crypto's C4; this branch predates it, so it is reached optionally. */
type WithSupabase = { getSupabase?: () => { auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> } } };

async function bearer(): Promise<string | null> {
  const getSupabase = (chatLib as unknown as WithSupabase).getSupabase;
  if (typeof getSupabase === 'function') {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  }
  const session = await getChat().ensureSession(false);
  return session?.access_token ?? null;
}

export type ReportReason = 'spam' | 'abuse' | 'illegal' | 'other';

export const REPORT_REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'abuse', label: 'Abuse' },
  { value: 'illegal', label: 'Illegal' },
  { value: 'other', label: 'Other' },
];

const REPORT_URL = 'https://onepeek.io/api/chat/report';

/** Throws `not_signed_in` without a session and `report_failed` on any non-2xx answer. */
export async function reportRoom(roomId: string, reason: ReportReason): Promise<void> {
  const token = await bearer();
  if (!token) throw Object.assign(new Error('failed: not_signed_in'), { code: 'not_signed_in' });
  const res = await fetch(REPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ room: roomId, reason }),
  });
  if (res.status === 401) throw Object.assign(new Error('failed: not_signed_in'), { code: 'not_signed_in' });
  if (res.status === 429) throw Object.assign(new Error('failed: rate_limited'), { code: 'rate_limited' });
  if (!res.ok) throw Object.assign(new Error('failed: report_failed'), { code: 'report_failed' });
}
