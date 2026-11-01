// Config plugin (N1): sets WindowManager.LayoutParams.FLAG_SECURE on the main activity's window in
// `onCreate`, so by default every screen of the app is black in screenshots, screen recordings and
// the recent-apps switcher on Android. The `useSecureScreen()` hook in apps/mobile/security re-asserts
// the flag per chat / secret screen through expo-screen-capture; this plugin is the baseline that
// does not depend on any JS running.
//
// Mod used: `withMainActivity` from expo/config-plugins (modResults = { path, contents, language })
// https://docs.expo.dev/config-plugins/mods/ — `mods.android.mainActivity`, the file as a string.
// Android API: https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE
// Template matched: Expo SDK 58 bare template MainActivity.kt
// (templates/expo-template-bare-minimum/android/app/src/main/java/.../MainActivity.kt), whose
// onCreate is `setTheme(R.style.AppTheme); super.onCreate(null)`.
const { withMainActivity, createRunOncePlugin } = require('expo/config-plugins');

const MARKER = '// onepeek: FLAG_SECURE (plugins/withSecureWindow.js)';

const KT_IMPORT = 'import android.view.WindowManager';
const JAVA_IMPORT = 'import android.view.WindowManager;';

const KT_LINE = `    ${MARKER}\n    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)`;
const JAVA_LINE = `    ${MARKER}\n    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);`;

/** Adds `line` after the first import line if it is not already present. */
function addImport(contents, line) {
  if (contents.includes(line)) return contents;
  const m = contents.match(/^import .*$/m);
  if (!m) throw new Error('withSecureWindow: MainActivity has no import lines');
  return contents.replace(m[0], `${m[0]}\n${line}`);
}

/**
 * Pure transform used by the mod and by the unit test. Inserts the FLAG_SECURE call right after the
 * `super.onCreate(...)` call inside `onCreate`. Idempotent (a second run returns the same string).
 * Throws when the activity has no `onCreate` with a `super.onCreate` call, so prebuild fails loudly
 * instead of silently producing an unprotected build.
 */
function setSecureWindow(contents, language) {
  if (contents.includes(MARKER)) return contents;
  const isKotlin = language === 'kt';
  const withImport = addImport(contents, isKotlin ? KT_IMPORT : JAVA_IMPORT);
  const superCall = isKotlin ? /^(\s*)super\.onCreate\([^)]*\)\s*$/m : /^(\s*)super\.onCreate\([^)]*\);\s*$/m;
  const m = withImport.match(superCall);
  if (!m) throw new Error('withSecureWindow: no super.onCreate(...) call found in MainActivity.onCreate');
  const line = isKotlin ? KT_LINE : JAVA_LINE;
  return withImport.replace(m[0], `${m[0]}\n${line}`);
}

const withSecureWindow = (config) =>
  withMainActivity(config, (cfg) => {
    cfg.modResults.contents = setSecureWindow(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });

module.exports = createRunOncePlugin(withSecureWindow, 'onepeek-secure-window', '1.0.0');
module.exports.setSecureWindow = setSecureWindow;
module.exports.MARKER = MARKER;
