import ExpoModulesCore

// OnePeek native-security module (N2, N3 on iOS).
//
// - `isCaptured()` / event `onCapturedChange`: UIScreen.main.isCaptured and
//   UIScreen.capturedDidChangeNotification (screen recording, AirPlay / mirroring; NOT screenshots).
//   https://developer.apple.com/documentation/uikit/uiscreen/iscaptured
//   https://developer.apple.com/documentation/uikit/uiscreen/captureddidchangenotification
//   iOS cannot block a screenshot; expo-screen-capture reports one after the fact.
// - `excludeFromBackup(path)`: sets URLResourceValues.isExcludedFromBackup on the given file or
//   directory so iCloud / Finder backups skip it. A missing directory is created first, so the flag
//   is in place before SQLite writes into it; a missing file is skipped (returns false).
//   https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup
//
// Module API: https://docs.expo.dev/modules/module-api/ (Name, Events, Function, AsyncFunction,
// OnStartObserving / OnStopObserving).
public final class ScreenStateModule: Module {
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("ScreenState")

    Events("onCapturedChange")

    Function("isCaptured") { () -> Bool in
      return UIScreen.main.isCaptured
    }

    OnStartObserving {
      if !observing {
        NotificationCenter.default.addObserver(
          self,
          selector: #selector(self.capturedDidChange),
          name: UIScreen.capturedDidChangeNotification,
          object: nil
        )
        observing = true
      }
    }

    OnStopObserving {
      if observing {
        NotificationCenter.default.removeObserver(self, name: UIScreen.capturedDidChangeNotification, object: nil)
        observing = false
      }
    }

    OnDestroy {
      if observing {
        NotificationCenter.default.removeObserver(self, name: UIScreen.capturedDidChangeNotification, object: nil)
        observing = false
      }
    }

    AsyncFunction("excludeFromBackup") { (path: String, isDirectory: Bool) -> Bool in
      let fm = FileManager.default
      var url = URL(fileURLWithPath: path, isDirectory: isDirectory)
      if isDirectory && !fm.fileExists(atPath: path) {
        try fm.createDirectory(at: url, withIntermediateDirectories: true, attributes: nil)
      }
      guard fm.fileExists(atPath: path) else {
        return false
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return true
    }
  }

  @objc
  private func capturedDidChange() {
    sendEvent("onCapturedChange", ["captured": UIScreen.main.isCaptured])
  }
}
