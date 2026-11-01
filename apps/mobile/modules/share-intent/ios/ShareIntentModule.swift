import ExpoModulesCore

// iOS side of the OnePeek share-intent module: STUBS ON PURPOSE.
//
// iOS has no "share intent" delivered to the app process. A Share Extension (separate target, see
// plugins/withShareExtension.js, experimental) runs in its own process, writes the shared items into
// the App Group container and asks the OS to open `onepeek://share`; the app then reads the group
// container from JS through expo-file-system's `Paths.appleSharedContainers`
// (apps/mobile/security/appGroup.ts). Nothing native is needed in the app target for that, so this
// module only exists so `requireOptionalNativeModule('ShareIntent')` resolves to the same API on both
// platforms (every function reports "nothing pending").
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
