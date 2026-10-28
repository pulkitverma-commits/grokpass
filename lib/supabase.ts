import { createClient, SupabaseClient, type Session } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase: SupabaseClient | null = (url && key)
  ? createClient(url, key)
  : null;

/** The account behind a session, ignoring Secret Chat guest (anonymous) sessions. */
export function accountUser(session: Session | null | undefined) {
  const u = session?.user;
  return u && !u.is_anonymous ? u : null;
}
