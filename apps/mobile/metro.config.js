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

module.exports = config;
