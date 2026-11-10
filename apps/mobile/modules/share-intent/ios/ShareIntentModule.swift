import ExpoModulesCore

// iOS side of the OnePeek share-intent module: STUBS ON PURPOSE.
//
// iOS has no "share intent" delivered to the app process. Receiving from the share sheet is done by
// `expo-share-intent` (config plugin: Share Extension target + App Group; JS hook in the app), consumed by
// apps/mobile/security/shareIntent.ts + iosShare.ts. Nothing native is needed in the app target beyond
// that package, so this module only exists so `requireOptionalNativeModule('ShareIntent')` resolves to the
// same API on both platforms (every function reports "nothing pending").
//
// Module API: https://docs.expo.dev/modules/module-api/
public final class ShareIntentModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShareIntent")

    Events("onShare")

    AsyncFunction("getPendingShare") { () -> [String: Any]? in
      return nil
    }

    Function("clearPendingShare") {
      // nothing is held on iOS
    }

    Function("clearIntentData") {
      // iOS has no launching Intent; expo-linking's cached initial URL is cleared from JS
      // (Linking.clearInitialURL) by apps/mobile/security/links.ts#forgetLinkingURL.
    }
  }
}
