// React Native adapters for the chat ports. Imported by apps/mobile through `@onepeek/core/src/rn`,
// never by the web (the main index does not re-export this directory).
export {
  createRnKeyStore, WRAP_KEY_ID, DB_NAME,
  type RnKeyStoreOptions, type SecureStoreLike, type SecureStoreOptionsLike, type SqliteBindValue, type SqliteDatabaseLike, type SqliteModuleLike,
} from './keystore';
export { installRnCrypto, assertSubtleSupport } from './crypto';
export {
  createRnPlatform, createRnEnv, createRnLockStore, fileSource, wrapRnSupabase, bodyToArrayBuffer, LOCK_ID,
  type RnPlatformOptions, type RnEnvOptions, type RnLockStore, type RnPickedFile,
} from './platform';
