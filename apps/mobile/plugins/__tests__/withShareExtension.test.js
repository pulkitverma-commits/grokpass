/* global describe, test, expect, jest */
const {
  setAppGroup, extensionInfoPlist, extensionEntitlements, shareViewControllerSwift, extensionBuildSettings,
  addExtensionTarget, toPlist, APP_GROUPS_KEY, DEFAULT_GROUP, MARKER,
} = require('../withShareExtension');

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

  test('rejects an identifier that is not an App Group', () => {
    expect(() => setAppGroup({}, 'io.onepeek.app')).toThrow('invalid App Group');
    expect(() => setAppGroup({}, 'group.bad id')).toThrow('invalid App Group');
  });
});

describe('extension files (pure generators)', () => {
  test('Info.plist: share-services extension point, principal class, activation rule for text/url/image/movie/file', () => {
    const p = extensionInfoPlist({ displayName: 'OnePeek' });
    expect(p.NSExtension.NSExtensionPointIdentifier).toBe('com.apple.share-services');
    expect(p.NSExtension.NSExtensionPrincipalClass).toBe('$(PRODUCT_MODULE_NAME).ShareViewController');
    expect(p.NSExtension.NSExtensionAttributes.NSExtensionActivationRule).toEqual({
      NSExtensionActivationSupportsText: true,
      NSExtensionActivationSupportsWebURLWithMaxCount: 1,
      NSExtensionActivationSupportsImageWithMaxCount: 10,
      NSExtensionActivationSupportsMovieWithMaxCount: 10,
      NSExtensionActivationSupportsFileWithMaxCount: 10,
    });
    expect(p.CFBundleDisplayName).toBe('OnePeek');
  });

  test('entitlements: the same App Group as the app', () => {
    expect(extensionEntitlements('group.io.onepeek.app')).toEqual({ [APP_GROUPS_KEY]: ['group.io.onepeek.app'] });
  });

  test('Swift: marker, group id, wake URL, manifest format, random names, no logging', () => {
    const s = shareViewControllerSwift({ group: 'group.io.onepeek.app', scheme: 'onepeek' });
    expect(s).toContain(MARKER);
    expect(s).toContain('private let group = "group.io.onepeek.app"');
    expect(s).toContain('URL(string: "onepeek://share")');
    expect(s).toContain('appendingPathComponent("share-intent"');
    expect(s).toContain('appendingPathComponent("pending.json")');
    expect(s).toContain('"v": 1');
    expect(s).toContain('SecRandomCopyBytes');
    expect(s).toContain('completeFileProtectionUntilFirstUserAuthentication');
    expect(s).not.toMatch(/\bprint\(|NSLog|os_log/);
    // Type order: concrete files, then URL, then text, then generic data (see the UTType conformance note).
    const idx = (needle) => s.indexOf(needle);
    expect(idx('has(.fileURL) || has(.image) || has(.movie)')).toBeLessThan(idx('if has(.url)'));
    expect(idx('if has(.url)')).toBeLessThan(idx('if has(.plainText)'));
    expect(idx('if has(.plainText)')).toBeLessThan(idx('if has(.data)'));
  });

  test('toPlist serialises strings, booleans, integers, arrays and dictionaries', () => {
    const xml = toPlist({ A: 'x<y', B: true, C: 2, D: ['a'], E: { F: false } });
    expect(xml).toContain('<key>A</key>\n  <string>x&lt;y</string>');
    expect(xml).toContain('<key>B</key>\n  <true/>');
    expect(xml).toContain('<key>C</key>\n  <integer>2</integer>');
    expect(xml).toContain('<array>\n    <string>a</string>\n  </array>');
    expect(xml).toContain('<key>F</key>\n    <false/>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  test('build settings point at the extension folder and sign with its entitlements', () => {
    const b = extensionBuildSettings({ bundleId: 'io.onepeek.app.share', name: 'OnePeekShare', version: '1.2.3', buildNumber: '7' });
    expect(b.PRODUCT_BUNDLE_IDENTIFIER).toBe('"io.onepeek.app.share"');
    expect(b.INFOPLIST_FILE).toBe('"OnePeekShare/Info.plist"');
    expect(b.CODE_SIGN_ENTITLEMENTS).toBe('"OnePeekShare/OnePeekShare.entitlements"');
    expect(b.MARKETING_VERSION).toBe('1.2.3');
    expect(b.CURRENT_PROJECT_VERSION).toBe('7');
    expect(b.IPHONEOS_DEPLOYMENT_TARGET).toBe('15.1');
  });
});

describe('addExtensionTarget (xcode project wiring; the pbxproj itself is only verified by an EAS build, S27)', () => {
  function fakeProject() {
    const configs = { C1: { buildSettings: { PRODUCT_NAME: '"$(TARGET_NAME)"' } }, C2: { buildSettings: {} } };
    const targets = {};
    const project = {
      addTarget: jest.fn((name, type, subfolder, bundleId) => {
        const t = { uuid: 'T1', pbxNativeTarget: { name: `"${name}"`, buildConfigurationList: 'L1' } };
        targets.T1 = { name: `"${name}"`, type, subfolder, bundleId };
        return t;
      }),
      addBuildPhase: jest.fn(),
      addPbxGroup: jest.fn(),
      pbxNativeTargetSection: () => targets,
      pbxXCBuildConfigurationSection: () => configs,
      pbxXCConfigurationList: () => ({ L1: { buildConfigurations: [{ value: 'C1' }, { value: 'C2' }] } }),
    };
    return { project, configs };
  }

  test('adds an app_extension target with Sources/Resources/Frameworks phases, a group and build settings on every configuration', () => {
    const { project, configs } = fakeProject();
    addExtensionTarget(project, { name: 'OnePeekShare', bundleId: 'io.onepeek.app.share', version: '1.0.0', buildNumber: '1' });
    expect(project.addTarget).toHaveBeenCalledWith('OnePeekShare', 'app_extension', 'OnePeekShare', 'io.onepeek.app.share');
    expect(project.addBuildPhase).toHaveBeenCalledWith(['OnePeekShare/ShareViewController.swift'], 'PBXSourcesBuildPhase', 'Sources', 'T1');
    expect(project.addBuildPhase).toHaveBeenCalledWith([], 'PBXResourcesBuildPhase', 'Resources', 'T1');
    expect(project.addBuildPhase).toHaveBeenCalledWith([], 'PBXFrameworksBuildPhase', 'Frameworks', 'T1');
    expect(project.addPbxGroup).toHaveBeenCalledWith(['OnePeekShare/ShareViewController.swift', 'OnePeekShare/Info.plist', 'OnePeekShare/OnePeekShare.entitlements'], 'OnePeekShare', 'OnePeekShare');
    expect(configs.C1.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).toBe('"io.onepeek.app.share"');
    expect(configs.C2.buildSettings.CODE_SIGN_ENTITLEMENTS).toBe('"OnePeekShare/OnePeekShare.entitlements"');
  });

  test('idempotent: a target of that name already present is left alone', () => {
    const { project } = fakeProject();
    addExtensionTarget(project, { name: 'OnePeekShare', bundleId: 'io.onepeek.app.share' });
    addExtensionTarget(project, { name: 'OnePeekShare', bundleId: 'io.onepeek.app.share' });
    expect(project.addTarget).toHaveBeenCalledTimes(1);
  });
});

describe('plugin gating', () => {
  test('without `extension: true` only the entitlements mod is registered; with it, the ios dangerous and xcodeproj mods too', () => {
    const plugin = require('../withShareExtension');
    const base = { name: 'OnePeek', slug: 'onepeek', scheme: 'onepeek', ios: { bundleIdentifier: 'io.onepeek.app' } };
    const off = plugin({ ...base }, { appGroup: 'group.io.onepeek.app' });
    expect(Object.keys(off.mods.ios)).toEqual(['entitlements']);
    const on = plugin({ ...base, _internal: {} }, { appGroup: 'group.io.onepeek.app', extension: true });
    expect(Object.keys(on.mods.ios).sort()).toEqual(['dangerous', 'entitlements', 'xcodeproj']);
  });
});
