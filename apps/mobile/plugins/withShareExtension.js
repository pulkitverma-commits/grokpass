// Config plugin (N6, iOS): App Group for the app target, and — EXPERIMENTAL, off unless the option
// `extension: true` is passed — a Share Extension target that receives text, URLs, images, movies and
// files from the iOS share sheet, writes them into the App Group container and opens `onepeek://share`.
//
// STATUS. The App Group half (`setAppGroup`) uses the documented `withEntitlementsPlist` mod and is
// covered by tests. The extension half has NEVER BEEN COMPILED: this Mac has no Xcode and the first
// compile happens in an EAS build. It is wired through the `xcode` package's `addTarget('app_extension')`,
// `addBuildPhase` and per-configuration build settings, which is the same mechanism community plugins
// use, but the exact pbxproj that comes out must be checked once (MANUAL-CHECKS S27). Until then the
// recommended path for iOS sharing is the maintained package (`expo-share-intent`, see README §N6),
// and the hand-written extension is a fallback the lead can enable with `ONEPEEK_SHARE_EXTENSION=1`.
//
// Mods and APIs:
//   withEntitlementsPlist  https://docs.expo.dev/config-plugins/mods/  (`mods.ios.entitlements`, the app target's .entitlements as JSON)
//   withDangerousMod('ios') writes the extension's files under <ios project root>/<Name>/
//   withXcodeProject        modResults is an `xcode` PBXProject (https://github.com/apache/cordova-node-xcode)
//   App Groups             https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.application-groups
//   Share extension keys   https://developer.apple.com/documentation/bundleresources/information-property-list/nsextension
//                          NSExtensionActivationRule: https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/SystemExtensionKeys.html
//   EAS: the extension target is signed with its own provisioning profile; with EAS-managed credentials
//        this needs `ios.appExtensions` in app.config (lead; https://docs.expo.dev/build-reference/app-extensions/)
//        and the App Group capability on BOTH identifiers in the Apple Developer portal (EAS syncs
//        capabilities from the entitlements for the main target; verify for the extension).
const fs = require('fs');
const path = require('path');
const { withEntitlementsPlist, withDangerousMod, withXcodeProject, createRunOncePlugin } = require('expo/config-plugins');

const APP_GROUPS_KEY = 'com.apple.security.application-groups';
const DEFAULT_GROUP = 'group.io.onepeek.app';
const DEFAULT_NAME = 'OnePeekShare';
const MARKER = 'onepeek: share extension (plugins/withShareExtension.js)';
const SHARE_DIR = 'share-intent';
const MANIFEST = 'pending.json';

/** Pure: adds `group` to the app's application-groups entitlement (idempotent, keeps other groups). */
function setAppGroup(entitlements, group = DEFAULT_GROUP) {
  if (typeof group !== 'string' || !/^group\.[A-Za-z0-9.-]+$/.test(group)) {
    throw new Error(`withShareExtension: invalid App Group identifier`);
  }
  const current = Array.isArray(entitlements[APP_GROUPS_KEY]) ? entitlements[APP_GROUPS_KEY] : [];
  if (current.includes(group)) return entitlements;
  return { ...entitlements, [APP_GROUPS_KEY]: [...current, group] };
}

/** Pure: the extension's Info.plist (what the share sheet offers OnePeek for). */
function extensionInfoPlist({ displayName = 'OnePeek', maxFiles = 10 } = {}) {
  return {
    CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
    CFBundleDisplayName: displayName,
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    NSExtension: {
      NSExtensionPointIdentifier: 'com.apple.share-services',
      NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
      NSExtensionAttributes: {
        NSExtensionActivationRule: {
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsImageWithMaxCount: maxFiles,
          NSExtensionActivationSupportsMovieWithMaxCount: maxFiles,
          NSExtensionActivationSupportsFileWithMaxCount: maxFiles,
        },
      },
    },
  };
}

/** Pure: the extension's entitlements (the same App Group as the app). */
function extensionEntitlements(group = DEFAULT_GROUP) {
  return { [APP_GROUPS_KEY]: [group] };
}

/**
 * Pure: the extension's only source file. Loads every attachment through NSItemProvider, writes the
 * items into <group>/share-intent/ under random names plus a pending.json manifest (the format
 * apps/mobile/security/appGroup.ts reads), then asks the OS to open `<scheme>://share` and completes.
 * Opening a URL from a share extension is not an official API (only Today widgets get
 * NSExtensionContext.open); the responder-chain call below is the widely used workaround and it may
 * stop working in any iOS release. When it does, the share is still in the group container and the app
 * reads it on its next launch / foreground (useShareIntent), so nothing is lost, only the hop.
 */
function shareViewControllerSwift({ group = DEFAULT_GROUP, scheme = 'onepeek' } = {}) {
  return `import UIKit
import UniformTypeIdentifiers

// ${MARKER}
// Generated by plugins/withShareExtension.js; edit the plugin, not this file (ios/ is CNG output).
// NSItemProvider: https://developer.apple.com/documentation/foundation/nsitemprovider
// loadFileRepresentation: https://developer.apple.com/documentation/foundation/nsitemprovider/loadfilerepresentation(fortypeidentifier:completionhandler:)
// NSExtensionContext: https://developer.apple.com/documentation/foundation/nsextensioncontext
// containerURL(forSecurityApplicationGroupIdentifier:): https://developer.apple.com/documentation/foundation/filemanager/containerurl(forsecurityapplicationgroupidentifier:)
final class ShareViewController: UIViewController {
  private let group = "${group}"
  private let wakeURL = URL(string: "${scheme}://share")!
  private var items: [[String: String]] = []
  private let lock = NSLock()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    guard let dir = shareDirectory() else { return finish() }
    let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
    if providers.isEmpty { return finish() }
    let pending = DispatchGroup()
    for provider in providers {
      pending.enter()
      load(provider, into: dir) { pending.leave() }
    }
    pending.notify(queue: .main) { [weak self] in
      guard let self = self else { return }
      self.writeManifest(in: dir)
      self.wakeApp()
      self.finish()
    }
  }

  private func shareDirectory() -> URL? {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
    let dir = root.appendingPathComponent("${SHARE_DIR}", isDirectory: true)
    try? FileManager.default.removeItem(at: dir)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      return dir
    } catch {
      return nil
    }
  }

  private func load(_ provider: NSItemProvider, into dir: URL, done: @escaping () -> Void) {
    // Order matters (UTType conformance, https://developer.apple.com/documentation/uniformtypeidentifiers):
    // public.file-url, public.url and public.plain-text all conform to public.data, and a file URL
    // conforms to public.url. So: concrete files first, then web URLs, then text, and public.data last.
    let has = { (t: UTType) in provider.hasItemConformingToTypeIdentifier(t.identifier) }
    if has(.fileURL) || has(.image) || has(.movie) {
      let type = [UTType.fileURL, UTType.image, UTType.movie].first(where: has)!
      copyFile(provider, type: type, into: dir, done: done)
      return
    }
    if has(.url) {
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] item, _ in
        defer { done() }
        if let url = item as? URL { self?.append(["kind": "text", "text": url.absoluteString]) }
      }
      return
    }
    if has(.plainText) {
      provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
        defer { done() }
        if let text = item as? String, !text.isEmpty { self?.append(["kind": "text", "text": text]) }
        else if let data = item as? Data, let text = String(data: data, encoding: .utf8), !text.isEmpty { self?.append(["kind": "text", "text": text]) }
      }
      return
    }
    if has(.data) {
      copyFile(provider, type: .data, into: dir, done: done)
      return
    }
    done()
  }

  private func copyFile(_ provider: NSItemProvider, type: UTType, into dir: URL, done: @escaping () -> Void) {
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] url, _ in
      defer { done() }
      guard let self = self, let url = url else { return }
      let ext = url.pathExtension.lowercased()
      let safeExt = (!ext.isEmpty && ext.count <= 8 && ext.allSatisfy { $0.isLetter || $0.isNumber }) ? "." + ext : ""
      let name = self.randomName() + safeExt
      do {
        try FileManager.default.copyItem(at: url, to: dir.appendingPathComponent(name))
        self.append(["kind": "file", "name": name])
      } catch { /* skipped */ }
    }
  }

  private func append(_ item: [String: String]) {
    lock.lock(); items.append(item); lock.unlock()
  }

  private func writeManifest(in dir: URL) {
    lock.lock(); let snapshot = items; lock.unlock()
    guard !snapshot.isEmpty else { return }
    let payload: [String: Any] = ["v": 1, "items": snapshot]
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
    try? data.write(to: dir.appendingPathComponent("${MANIFEST}"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  private func randomName() -> String {
    var bytes = [UInt8](repeating: 0, count: 12)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
  }

  /// Not an official API for share extensions: walks the responder chain for an object that opens URLs.
  private func wakeApp() {
    var responder: UIResponder? = self
    let selector = NSSelectorFromString("openURL:")
    while let r = responder {
      if r.responds(to: selector) && !(r is UIViewController) {
        r.perform(selector, with: wakeURL)
        return
      }
      responder = r.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
`;
}

/** Serialises a plain object into an XML plist (strings, booleans, numbers, arrays, dictionaries). */
function toPlist(obj) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const node = (v, indent) => {
    const pad = '  '.repeat(indent);
    if (typeof v === 'string') return `${pad}<string>${esc(v)}</string>`;
    if (typeof v === 'boolean') return `${pad}<${v ? 'true' : 'false'}/>`;
    if (typeof v === 'number') return `${pad}<integer>${v}</integer>`;
    if (Array.isArray(v)) return `${pad}<array>\n${v.map((x) => node(x, indent + 1)).join('\n')}\n${pad}</array>`;
    const entries = Object.keys(v).map((k) => `${pad}  <key>${esc(k)}</key>\n${node(v[k], indent + 1)}`);
    return `${pad}<dict>\n${entries.join('\n')}\n${pad}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${node(obj, 0)}\n</plist>\n`;
}

/** Pure: build settings for the extension target, per configuration. */
function extensionBuildSettings({ bundleId, name, version = '1.0.0', buildNumber = '1', deploymentTarget = '15.1' }) {
  return {
    PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
    PRODUCT_NAME: `"${name}"`,
    INFOPLIST_FILE: `"${name}/Info.plist"`,
    CODE_SIGN_ENTITLEMENTS: `"${name}/${name}.entitlements"`,
    SWIFT_VERSION: '5.0',
    IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
    TARGETED_DEVICE_FAMILY: '"1"',
    MARKETING_VERSION: version,
    CURRENT_PROJECT_VERSION: buildNumber,
    GENERATE_INFOPLIST_FILE: 'NO',
    SKIP_INSTALL: 'YES',
    LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
    CODE_SIGN_STYLE: 'Automatic',
  };
}

/** Pure: adds the extension target to an `xcode` project unless it is already there (idempotent by name). */
function addExtensionTarget(project, { name, bundleId, version, buildNumber }) {
  const existing = Object.values(project.pbxNativeTargetSection()).find((t) => t && typeof t === 'object' && t.name === `"${name}"`);
  if (existing) return project;
  const target = project.addTarget(name, 'app_extension', name, bundleId);
  project.addBuildPhase([`${name}/ShareViewController.swift`], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  project.addPbxGroup([`${name}/ShareViewController.swift`, `${name}/Info.plist`, `${name}/${name}.entitlements`], name, name);
  const settings = extensionBuildSettings({ bundleId, name, version, buildNumber });
  const configs = project.pbxXCBuildConfigurationSection();
  const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
  for (const ref of list.buildConfigurations) {
    const cfg = configs[ref.value];
    if (!cfg || !cfg.buildSettings) continue;
    Object.assign(cfg.buildSettings, settings);
  }
  return project;
}

const withShareExtension = (config, props = {}) => {
  const group = props.appGroup || DEFAULT_GROUP;
  const name = props.extensionName || DEFAULT_NAME;
  const enabled = props.extension === true;

  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults = setAppGroup(cfg.modResults, group);
    return cfg;
  });
  if (!enabled) return config;

  const bundleId = `${config.ios && config.ios.bundleIdentifier}.share`;
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme || 'onepeek';

  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ShareViewController.swift'), shareViewControllerSwift({ group, scheme }));
      fs.writeFileSync(path.join(dir, 'Info.plist'), toPlist(extensionInfoPlist({ displayName: cfg.name || 'OnePeek' })));
      fs.writeFileSync(path.join(dir, `${name}.entitlements`), toPlist(extensionEntitlements(group)));
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    addExtensionTarget(cfg.modResults, {
      name,
      bundleId,
      version: cfg.version || '1.0.0',
      buildNumber: (cfg.ios && cfg.ios.buildNumber) || '1',
    });
    return cfg;
  });
  return config;
};

module.exports = createRunOncePlugin(withShareExtension, 'onepeek-share-extension', '0.1.0-experimental');
module.exports.setAppGroup = setAppGroup;
module.exports.extensionInfoPlist = extensionInfoPlist;
module.exports.extensionEntitlements = extensionEntitlements;
module.exports.shareViewControllerSwift = shareViewControllerSwift;
module.exports.extensionBuildSettings = extensionBuildSettings;
module.exports.addExtensionTarget = addExtensionTarget;
module.exports.toPlist = toPlist;
module.exports.APP_GROUPS_KEY = APP_GROUPS_KEY;
module.exports.DEFAULT_GROUP = DEFAULT_GROUP;
module.exports.MARKER = MARKER;
