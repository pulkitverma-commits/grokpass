/* global describe, test, expect */
const { setAppGroup, APP_GROUPS_KEY, DEFAULT_GROUP } = require('../withAppGroup');

describe('setAppGroup (app target entitlements)', () => {
  test('adds the group to an empty entitlements file', () => {
    expect(setAppGroup({})).toEqual({ [APP_GROUPS_KEY]: [DEFAULT_GROUP] });
  });

  test('keeps other entitlements and other groups; idempotent', () => {
    const before = { 'com.apple.developer.associated-domains': ['applinks:onepeek.io'], [APP_GROUPS_KEY]: ['group.other'] };
    const once = setAppGroup(before, 'group.io.onepeek.app');
    expect(once).toEqual({ 'com.apple.developer.associated-domains': ['applinks:onepeek.io'], [APP_GROUPS_KEY]: ['group.other', 'group.io.onepeek.app'] });
    expect(setAppGroup(once, 'group.io.onepeek.app')).toBe(once);
  });

  test('dedupes what expo-share-intent prepends (it does not check for an existing entry)', () => {
    const afterPackage = { [APP_GROUPS_KEY]: ['group.io.onepeek.app', 'group.io.onepeek.app'] };
    expect(setAppGroup(afterPackage, 'group.io.onepeek.app')).toEqual({ [APP_GROUPS_KEY]: ['group.io.onepeek.app'] });
  });

  test('rejects an identifier that is not an App Group', () => {
    expect(() => setAppGroup({}, 'io.onepeek.app')).toThrow('invalid App Group');
    expect(() => setAppGroup({}, 'group.bad id')).toThrow('invalid App Group');
  });

  test('registers only the entitlements mod', () => {
    const plugin = require('../withAppGroup');
    const out = plugin({ name: 'OnePeek', slug: 'onepeek', ios: { bundleIdentifier: 'io.onepeek.app' } }, { appGroup: 'group.io.onepeek.app' });
    expect(Object.keys(out.mods.ios)).toEqual(['entitlements']);
  });
});

describe('app.config.ts: the two N6b plugins agree (read-only check of the lead-owned file)', () => {
  const config = require('../../app.config').default({ config: {} });
  const plugins = config.plugins.map((p) => (Array.isArray(p) ? p : [p]));
  const ours = plugins.findIndex(([name]) => name === './plugins/withAppGroup.js');
  const pkg = plugins.findIndex(([name]) => name === 'expo-share-intent');

  test('both present, ours before the package (its entitlements mod then runs after the package and dedupes)', () => {
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(pkg).toBeGreaterThan(ours);
  });

  test('one App Group id in both places; Android half disabled; activation rules = text, 1 URL, 10 images/movies/files', () => {
    expect(plugins[ours][1]).toEqual({ appGroup: 'group.io.onepeek.app' });
    const opts = plugins[pkg][1];
    expect(opts.iosAppGroupIdentifier).toBe('group.io.onepeek.app');
    expect(opts.disableAndroid).toBe(true);
    expect(opts.disableIOS).toBeUndefined();
    expect(opts.iosActivationRules).toEqual({
      NSExtensionActivationSupportsText: true,
      NSExtensionActivationSupportsWebURLWithMaxCount: 1,
      NSExtensionActivationSupportsImageWithMaxCount: 10,
      NSExtensionActivationSupportsMovieWithMaxCount: 10,
      NSExtensionActivationSupportsFileWithMaxCount: 10,
    });
    // No WebPage rule: that one runs a JS preprocessor inside the shared Safari page (reads its metadata).
    expect(opts.iosActivationRules.NSExtensionActivationSupportsWebPageWithMaxCount).toBeUndefined();
    // The extension target may not collide with the main app target ("OnePeek").
    expect(opts.iosShareExtensionName.replace(/[^a-zA-Z0-9]/g, '')).not.toBe('OnePeek');
    // The package needs the scheme its extension wakes the app with.
    expect(config.scheme).toBe('onepeek');
    // The hand-written extension is gone: one iOS path.
    expect(plugins.some(([name]) => /withShareExtension/.test(name))).toBe(false);
  });
});
