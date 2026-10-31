// Metro in the npm-workspaces monorepo. The web app (React 18) and this app (React 19) share one
// hoisted node_modules, so every module is resolved from this app's node_modules first and the
// root second, with no hierarchical lookup: that keeps exactly one copy of react and react-native.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules'), path.join(workspaceRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

// ts-mls lazily imports optional code for ciphersuites Secret Chat doesn't use (X448, ChaCha20,
// ML-KEM, X-Wing, ML-DSA; see CIPHERSUITE in packages/core/src/chat/mls.ts). They are not installed;
// resolve them to empty modules, exactly as next.config.js does for the web.
const unused = new Set(['@noble/post-quantum/ml-dsa.js', '@hpke/chacha20poly1305', '@hpke/dhkem-x448', '@hpke/ml-kem', '@hpke/hybridkem-x-wing']);
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (unused.has(moduleName)) return { type: 'empty' };
  return defaultResolve ? defaultResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
