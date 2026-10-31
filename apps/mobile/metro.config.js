// Metro in the npm-workspaces monorepo. The web app (React 18) and this app (React 19) share one
// hoisted node_modules, so every module is resolved from this app's node_modules first and the
// root second, with no hierarchical lookup: that keeps exactly one copy of react and react-native.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
// Worktrees symlink node_modules to the main checkout; Metro only serves files under watchFolders, so
// the real directories behind those links are watched too (a no-op when they are not links).
const fs = require('node:fs');
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
config.watchFolders = [...new Set([workspaceRoot, real(path.join(workspaceRoot, 'node_modules')), real(path.join(projectRoot, 'node_modules'))])];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules'), path.join(workspaceRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

// ts-mls lazily imports optional code for ciphersuites Secret Chat doesn't use (X448, ChaCha20,
// ML-KEM, X-Wing, ML-DSA; see CIPHERSUITE in packages/core/src/chat/mls.ts). They are not installed;
// resolve them to empty modules, exactly as next.config.js does for the web.
const unused = new Set(['@noble/post-quantum/ml-dsa.js', '@hpke/chacha20poly1305', '@hpke/dhkem-x448', '@hpke/ml-kem', '@hpke/hybridkem-x-wing']);
const defaultResolve = config.resolver.resolveRequest;
// In a worktree the hoisted @onepeek/core link points at the main checkout; bundle this tree's copy.
const coreDir = path.join(workspaceRoot, 'packages', 'core');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (unused.has(moduleName)) return { type: 'empty' };
  if (moduleName === '@onepeek/core') return { type: 'sourceFile', filePath: path.join(coreDir, 'src', 'index.ts') };
  if (moduleName.startsWith('@onepeek/core/')) {
    const rest = moduleName.slice('@onepeek/core/'.length);
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
      const f = path.join(coreDir, rest + ext);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return { type: 'sourceFile', filePath: f };
    }
  }
  return defaultResolve ? defaultResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
