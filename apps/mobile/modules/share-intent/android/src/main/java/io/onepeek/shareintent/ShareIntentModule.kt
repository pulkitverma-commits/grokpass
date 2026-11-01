package io.onepeek.shareintent

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom

// OnePeek share-intent receiver (N6, Android).
//
// Reads the Intent that launched MainActivity (OnCreate → appContext.currentActivity.intent) and
// every later one (OnNewIntent; the Expo template's MainActivity is launchMode="singleTask", so a
// share while the app is alive arrives here instead of creating a second activity):
//   ACTION_SEND            EXTRA_TEXT (String) and/or EXTRA_STREAM (one Uri)
//   ACTION_SEND_MULTIPLE   EXTRA_STREAM (ArrayList<Uri>)
// https://developer.android.com/reference/android/content/Intent#ACTION_SEND
// https://developer.android.com/reference/android/content/Intent#ACTION_SEND_MULTIPLE
// https://developer.android.com/reference/android/content/Intent#EXTRA_STREAM
// https://developer.android.com/training/sharing/receive
//
// The Intent only *references* the source app's content (a content:// Uri with a temporary read grant,
// https://developer.android.com/reference/android/content/Intent#FLAG_GRANT_READ_URI_PERMISSION).
// `getPendingShare()` copies each item into <cacheDir>/share-intent/<random>.<ext> through
// ContentResolver.openInputStream (https://developer.android.com/reference/android/content/ContentResolver#openInputStream(android.net.Uri))
// and returns file:// URIs; the copy is a plaintext file that JS deletes once it has been encrypted
// and sent (apps/mobile/security/shareIntent.ts sweeps the directory). The cache directory is used
// on purpose: never the files/Documents dir, and it is excluded from backups like everything else
// (plugins/withBackupRules.js). The copy runs in an AsyncFunction, i.e. on the module queue, not
// the UI thread (https://docs.expo.dev/modules/module-api/#asyncfunction).
//
// Nothing here logs anything: no Uri, no text, no file name, no size.
class ShareIntentModule : Module() {
  private var pendingText: String? = null
  private var pendingUris: List<Uri> = emptyList()
  private var pendingToken: Long = 0L

  override fun definition() = ModuleDefinition {
    Name("ShareIntent")

    Events("onShare")

    OnCreate {
      appContext.currentActivity?.intent?.let { capture(it, notify = false) }
    }

    OnNewIntent { intent ->
      if (capture(intent, notify = true)) {
        // Replace the activity's intent so a later OnCreate (process restore from Recents) does not
        // re-deliver the same share. https://developer.android.com/reference/android/app/Activity#setIntent(android.content.Intent)
        appContext.currentActivity?.intent = intent
      }
    }

    /** Copies pending items into the cache and returns { text?: string, uris?: string[] } or null. */
    AsyncFunction("getPendingShare") { ->
      val text = pendingText
      val uris = pendingUris
      if (text == null && uris.isEmpty()) {
        return@AsyncFunction null
      }
      val out = mutableMapOf<String, Any>()
      if (text != null) out["text"] = text
      if (uris.isNotEmpty()) {
        val copied = uris.mapNotNull { copyToCache(it) }
        if (copied.isNotEmpty()) out["uris"] = copied
      }
      // Consumed: the Uri grants are single-use from our point of view; a second call returns null.
      pendingText = null
      pendingUris = emptyList()
      if (out.isEmpty()) null else out
    }

    Function("clearPendingShare") {
      pendingText = null
      pendingUris = emptyList()
      stripIntent()
    }

    /**
     * Removes data, action and extras from the activity's current Intent, so neither this module nor
     * react-native's Linking.getInitialURL() (which reads activity.intent.data, fragment included) can
     * read a consumed link or share again for the rest of the process.
     */
    Function("clearIntentData") {
      stripIntent()
    }
  }

  /** Records the share carried by [intent]; returns true when there was one. */
  private fun capture(intent: Intent, notify: Boolean): Boolean {
    val action = intent.action ?: return false
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return false
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotEmpty() }
    val uris = mutableListOf<Uri>()
    if (action == Intent.ACTION_SEND) {
      streamExtra(intent)?.let { uris.add(it) }
    } else {
      uris.addAll(streamExtras(intent))
    }
    // Some senders put the items in ClipData only (API 16+ mirror of EXTRA_STREAM).
    if (uris.isEmpty()) uris.addAll(clipUris(intent.clipData))
    if (text == null && uris.isEmpty()) return false
    pendingText = text
    pendingUris = uris.distinct()
    pendingToken += 1
    if (notify) {
      // Payload is a bare signal (no content): JS calls getPendingShare().
      sendEvent("onShare", mapOf("token" to pendingToken))
    }
    return true
  }

  @Suppress("DEPRECATION")
  private fun streamExtra(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
    }

  @Suppress("DEPRECATION")
  private fun streamExtras(intent: Intent): List<Uri> {
    val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
    }
    return list?.filterNotNull() ?: emptyList()
  }

  private fun clipUris(clip: ClipData?): List<Uri> {
    if (clip == null) return emptyList()
    val out = mutableListOf<Uri>()
    for (i in 0 until clip.itemCount) {
      clip.getItemAt(i).uri?.let { out.add(it) }
    }
    return out
  }

  private fun shareDir(): File = File(appContext.cacheDirectory, "share-intent")

  /** Copies one content Uri into the share cache under a random name; null when it cannot be read. */
  private fun copyToCache(uri: Uri): String? {
    val resolver = appContext.reactContext?.contentResolver ?: return null
    val scheme = uri.scheme ?: return null
    if (scheme != "content" && scheme != "file") return null
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(uri) ?: "")?.let { ".$it" }
      ?: extensionOf(uri)
    return try {
      val dir = shareDir()
      if (!dir.exists()) dir.mkdirs()
      val target = File(dir, randomName() + ext)
      resolver.openInputStream(uri)?.use { input ->
        FileOutputStream(target).use { output -> input.copyTo(output) }
      } ?: return null
      if (target.length() == 0L) {
        target.delete()
        null
      } else {
        Uri.fromFile(target).toString()
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun extensionOf(uri: Uri): String {
    val last = uri.lastPathSegment ?: return ""
    val dot = last.lastIndexOf('.')
    if (dot <= 0 || last.length - dot > 9) return ""
    val ext = last.substring(dot + 1)
    return if (ext.all { it.isLetterOrDigit() }) ".${ext.lowercase()}" else ""
  }

  private fun randomName(): String {
    val bytes = ByteArray(12)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  private fun stripIntent() {
    val activity = appContext.currentActivity ?: return
    val current = activity.intent ?: return
    val clean = Intent(current).apply {
      action = Intent.ACTION_MAIN
      data = null
      clipData = null
      removeExtra(Intent.EXTRA_TEXT)
      removeExtra(Intent.EXTRA_STREAM)
      removeExtra(Intent.EXTRA_SUBJECT)
      removeExtra(Intent.EXTRA_TITLE)
    }
    activity.intent = clean
  }
}
