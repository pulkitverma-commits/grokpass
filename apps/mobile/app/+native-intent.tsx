// expo-share-intent wakes the app with `onepeek://dataUrl=<key>...`, a URL that carries no content; the
// share-intent bridge in the root layout imports the shared items and opens /share itself. Without this
// redirect expo-router would try to open an unmatched route for the path "dataUrl=...".
//
// `/reset` (the recovery wipe) is never a deep-link target (review F-7): `onepeek://reset`, or a web
// link to it, opens home instead. The screen also refuses to act without the in-app pass.
import { isShareWakeUrl } from '@/security/links';

const RESET_PATH = /^(?:onepeek:\/\/|https:\/\/(?:www\.)?onepeek\.io\/|\/)?\/?reset(?:[/?#]|$)/i;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (isShareWakeUrl(path) || RESET_PATH.test(path)) return '/';
  return path;
}
