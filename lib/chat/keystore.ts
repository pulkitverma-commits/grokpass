// The web app's encrypted keystore (browser only): one instance of the IndexedDB KeyStore from
// packages/core/src/adapters/web/keystore.ts, which is where the implementation now lives.
// Exported both as the `keystore` object (what lib/chat/client.ts hands to the chat client) and
// as the module-level functions this file always had, so no caller changes.

import { createWebKeyStore } from '../../packages/core/src/adapters/web/keystore';

export type { KeyStore } from '../../packages/core/src/chat/ports';

export const keystore = createWebKeyStore();

export const { get, put, del, delPrefix, keys, sweep, wipe } = keystore;
