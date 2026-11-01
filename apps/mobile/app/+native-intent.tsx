// expo-share-intent wakes the app with `onepeek://dataUrl=<key>...`, a URL that carries no content; the
// share-intent bridge in the root layout imports the shared items and opens /share itself. Without this
// redirect expo-router would try to open an unmatched route for the path "dataUrl=...".
import { isShareWakeUrl } from '@/security';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return isShareWakeUrl(path) ? '/' : path;
}
