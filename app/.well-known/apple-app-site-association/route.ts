// Universal Links + Associated Domains for the iOS app. Apple fetches this once per install
// (through its CDN) and verifies it is served as JSON, with no redirect. Values come from env so a
// misconfigured deploy returns 404 and fails verification loudly instead of serving a valid empty file.
export const dynamic = 'force-dynamic';

export const BUNDLE_ID = 'io.onepeek.app';

/** Paths the app opens itself: secret links and chat invites (the invite token travels in the fragment). */
export const UNIVERSAL_LINK_COMPONENTS = [
  { '/': '/s/*', comment: 'Secret links' },
  { '/': '/chat/join', comment: 'Chat invites (token in the fragment)' },
  { '/': '/chat/join', '#': '*', comment: 'Chat invites with a fragment' },
];

export function appleAppSiteAssociation(teamId: string) {
  const appID = `${teamId}.${BUNDLE_ID}`;
  return {
    applinks: { details: [{ appIDs: [appID], components: UNIVERSAL_LINK_COMPONENTS }] },
    webcredentials: { apps: [appID] },
  };
}

export async function GET() {
  const teamId = (process.env.APPLE_TEAM_ID || '').trim();
  if (!/^[A-Z0-9]{10}$/.test(teamId)) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(appleAppSiteAssociation(teamId)), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
}
