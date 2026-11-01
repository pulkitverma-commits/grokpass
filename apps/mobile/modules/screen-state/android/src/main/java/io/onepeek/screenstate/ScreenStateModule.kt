package io.onepeek.screenstate

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android counterpart of ScreenStateModule.swift. Android has no "screen is being captured" state
// to report: FLAG_SECURE (plugins/withSecureWindow.js + expo-screen-capture) blanks recordings and
// screenshots at the window level, so `isCaptured` is always false here. Backup exclusion on Android
// is declared in the manifest (plugins/withBackupRules.js), so `excludeFromBackup` is a no-op that
// returns false ("nothing was marked"); the JS side treats false as "handled elsewhere".
class ScreenStateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScreenState")

    Events("onCapturedChange")

    Function("isCaptured") {
      false
    }

    AsyncFunction("excludeFromBackup") { _: String, _: Boolean ->
      false
    }
  }
}
