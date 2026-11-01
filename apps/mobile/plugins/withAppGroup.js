// Config plugin (N6b, iOS): the App Group entitlement on the APP target, `group.io.onepeek.app`.
//
// The Share Extension itself comes from `expo-share-intent` (its config plugin adds the extension target,
// the extension's own entitlements and `AppGroupIdentifier` in both Info.plists, see README N6b). That plugin
// also adds the app-target entitlement, by PREPENDING the group to `com.apple.security.application-groups`
// without checking whether it is already there. This plugin exists so the entitlement is asserted and
// deduplicated by code we own, whatever the package does in a future version:
//   - it must be listed BEFORE 'expo-share-intent' in `plugins` (a plugin registered later has its
//     entitlements mod run first, so this one sees the package's result and can dedupe it);
//   - `appGroup` must equal the package's `iosAppGroupIdentifier` (one id in both places; tested).
// Mod: withEntitlementsPlist https://docs.expo.dev/config-plugins/mods/ (`mods.ios.entitlements`).
// App Groups: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.application-groups
const { withEntitlementsPlist, createRunOncePlugin } = require('expo/config-plugins');

const APP_GROUPS_KEY = 'com.apple.security.application-groups';
const DEFAULT_GROUP = 'group.io.onepeek.app';

/** Pure: ensures `group` is in the app's application-groups entitlement, once; keeps other groups and other keys. */
function setAppGroup(entitlements, group = DEFAULT_GROUP) {
  if (typeof group !== 'string' || !/^group\.[A-Za-z0-9.-]+$/.test(group)) {
    throw new Error('withAppGroup: invalid App Group identifier');
  }
  const current = Array.isArray(entitlements[APP_GROUPS_KEY]) ? entitlements[APP_GROUPS_KEY] : [];
  const deduped = Array.from(new Set(current));
  if (!deduped.includes(group)) deduped.push(group);
  if (deduped.length === current.length && deduped.every((g, i) => g === current[i])) return entitlements;
  return { ...entitlements, [APP_GROUPS_KEY]: deduped };
}

const withAppGroup = (config, props = {}) => {
  const group = props.appGroup || DEFAULT_GROUP;
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults = setAppGroup(cfg.modResults, group);
    return cfg;
  });
};

module.exports = createRunOncePlugin(withAppGroup, 'onepeek-app-group', '1.0.0');
module.exports.setAppGroup = setAppGroup;
module.exports.APP_GROUPS_KEY = APP_GROUPS_KEY;
module.exports.DEFAULT_GROUP = DEFAULT_GROUP;
