// "Your secret was opened" and "Your request was answered" alerts: email + browser push.
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, layout } from './email';
import { escapeHtml } from './server';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:secret@onepeek.io';

export function pushConfigured() {
  return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

type Prefs = { email_on: boolean; push_on: boolean };
type Alert = { title: string; body: string; url: string; tag: string };

async function prefsFor(admin: SupabaseClient, owner: string): Promise<Prefs> {
  const { data } = await admin.from('notify_prefs').select('email_on, push_on').eq('owner', owner).maybeSingle();
  return { email_on: data?.email_on ?? true, push_on: data?.push_on ?? true };
}

export async function pushTo(admin: SupabaseClient, owner: string, alert: Alert) {
  if (!pushConfigured()) return 0;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('owner', owner);
  let sent = 0;
  await Promise.all((subs || []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(alert), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }));
  return sent;
}

async function ownerEmail(admin: SupabaseClient, owner: string) {
  const { data } = await admin.auth.admin.getUserById(owner);
  return data?.user?.email || null;
}

function placeOf(r: { open_area?: string | null; open_city?: string | null; open_region?: string | null; open_country?: string | null }) {
  const parts = [...(r.open_area ? r.open_area.split(', ') : []), r.open_city, r.open_region, r.open_country].filter(Boolean) as string[];
  return parts.filter((x, i) => parts.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ');
}

/** Called after a secret is opened. Does nothing for secrets sent while signed out. */
export async function notifyOpened(admin: SupabaseClient, id: string, site: string) {
  const { data: r } = await admin.from('secret_log')
    .select('owner, recipient, kind, share_location, open_area, open_city, open_region, open_country, open_source, views_used, max_views')
    .eq('id', id).maybeSingle();
  if (!r?.owner) return;
  const prefs = await prefsFor(admin, r.owner);
  const who = r.recipient ? `to ${r.recipient}` : '';
  const where = r.share_location ? placeOf(r) : '';
  const views = r.max_views > 1 ? ` (view ${r.views_used} of ${r.max_views})` : '';
  const burned = r.views_used >= r.max_views;
  const title = `Your secret ${who ? who + ' ' : ''}was opened`.replace(/\s+/g, ' ');
  const line = `${where ? `Opened in ${where}` : 'Opened just now'}${views}. ${burned ? 'It has now been deleted.' : 'It can still be opened again until the views run out.'}`;
  const url = `${site}/dashboard`;

  const jobs: Promise<unknown>[] = [];
  if (prefs.push_on) jobs.push(pushTo(admin, r.owner, { title, body: line, url, tag: `open-${id}` }));
  if (prefs.email_on) {
    jobs.push(ownerEmail(admin, r.owner).then(to => to ? sendEmail({
      to,
      subject: title,
      text: `${line}\n\nSee it in your dashboard: ${url}`,
      html: layout({
        title,
        body: `<p style="color:#3a414b;line-height:1.55;margin:0;">${escapeHtml(line)}</p>`,
        button: { label: 'Open dashboard', href: url },
        foot: 'You get this because alerts are on in your OnePeek dashboard. Turn them off there any time.',
      }),
    }) : null));
  }
  await Promise.allSettled(jobs);
}

/** Called after someone answers a request. */
export async function notifyAnswered(admin: SupabaseClient, requestId: string, owner: string, site: string) {
  const { data: r } = await admin.from('secret_requests').select('note, recipient').eq('id', requestId).maybeSingle();
  const prefs = await prefsFor(admin, owner);
  const title = `${r?.recipient ? r.recipient : 'Someone'} answered your request`;
  const line = `“${(r?.note || 'Your request').slice(0, 120)}” has an answer waiting. It can be read once.`;
  const url = `${site}/dashboard#requests`;
  const jobs: Promise<unknown>[] = [];
  if (prefs.push_on) jobs.push(pushTo(admin, owner, { title, body: line, url, tag: `req-${requestId}` }));
  if (prefs.email_on) {
    jobs.push(ownerEmail(admin, owner).then(to => to ? sendEmail({
      to, subject: title,
      text: `${line}\n\nOpen it from your dashboard: ${url}`,
      html: layout({
        title,
        body: `<p style="color:#3a414b;line-height:1.55;margin:0;">${escapeHtml(line)}</p>`,
        button: { label: 'Open dashboard', href: url },
      }),
    }) : null));
  }
  await Promise.allSettled(jobs);
}
