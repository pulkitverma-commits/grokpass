/* global describe, test, expect */
const { setSecureWindow, MARKER } = require('../withSecureWindow');

// Expo SDK 58 bare template MainActivity.kt (trimmed to the parts the plugin touches).
const KOTLIN = `package io.onepeek.app

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

const JAVA = `package io.onepeek.app;

import android.os.Bundle;
import com.facebook.react.ReactActivity;

public class MainActivity extends ReactActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    setTheme(R.style.AppTheme);
    super.onCreate(null);
  }
}
`;

describe('withSecureWindow.setSecureWindow', () => {
  test('Kotlin: adds the import and FLAG_SECURE right after super.onCreate', () => {
    const out = setSecureWindow(KOTLIN, 'kt');
    expect(out).toContain('import android.view.WindowManager\n');
    const i = out.indexOf('super.onCreate(null)');
    const j = out.indexOf('window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    // still inside onCreate (before the closing brace of the method)
    const close = out.indexOf('}', i);
    expect(j).toBeLessThan(close);
    expect(out).toContain(MARKER);
  });

  test('Kotlin: the rest of the file is untouched', () => {
    const out = setSecureWindow(KOTLIN, 'kt');
    const stripped = out
      .split('\n')
      .filter((l) => !l.includes('WindowManager') && !l.includes(MARKER))
      .join('\n');
    expect(stripped).toBe(KOTLIN);
  });

  test('is idempotent', () => {
    const once = setSecureWindow(KOTLIN, 'kt');
    expect(setSecureWindow(once, 'kt')).toBe(once);
    expect(once.match(/setFlags\(/g)).toHaveLength(1);   // exactly one call
  });

  test('Java: semicolons and getWindow()', () => {
    const out = setSecureWindow(JAVA, 'java');
    expect(out).toContain('import android.view.WindowManager;');
    expect(out).toContain('getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);');
    expect(out.indexOf('getWindow()')).toBeGreaterThan(out.indexOf('super.onCreate(null);'));
  });

  test('fails loudly when onCreate has no super call (no silent unprotected build)', () => {
    expect(() => setSecureWindow('package x\nimport a.b\nclass MainActivity', 'kt')).toThrow(/super\.onCreate/);
  });
});
