// Deep-link entry for invites: `https://onepeek.io/chat/join#<token>` (Universal Link / App Link)
// and `onepeek://chat/join#<token>`. The token is the URL fragment, read from the full URL via
// expo-linking (it never appears in route params or a request) and handed straight to the core.
// Once captured here, the launch URL is forgotten (`forgetLinkingURL`, P2-2): the token stays in
// this screen's state for the redeem and leaves the native initial-URL cache and the Android Intent.
// The QR scanner and the share target arrive here too, with the link parked in lib/links' hand-off.
// When both exist the tapped Universal Link wins (P3-2): a stash is at most HANDOFF_TTL_MS old and
// came from this user's own earlier action, but the link in hand is what they just asked to open.
import { useLinkingURL } from 'expo-linking';
import { useEffect, useState } from 'react';
import { forgetLinkingURL } from '@/security';
import { JoinScreen } from '../../components/JoinScreen';
import { inviteTokenFrom } from '@/lib/format';
import { takeHandoff } from '@/lib/links';

export default function JoinDeepLinkRoute() {
  const url = useLinkingURL();
  const [handed] = useState(() => takeHandoff('invite'));
  const token = inviteTokenFrom(url) ?? inviteTokenFrom(handed);
  useEffect(() => { if (token) forgetLinkingURL(); }, [token]);
  return <JoinScreen key={token ?? ''} initialToken={token} />;
}
