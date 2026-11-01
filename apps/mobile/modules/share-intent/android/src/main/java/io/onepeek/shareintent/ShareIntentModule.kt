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
// Caps (security review P2-4; mirrored in apps/mobile/security/constants.ts and src/ShareIntentModule.ts):
// content:// URIs only (a file:// URI would be opened with OUR permissions: a hostile sender could point
// it at our own databases/ or shared_prefs/), never a URI whose authority belongs to this package, at most
// MAX_ITEMS items and MAX_ITEM_BYTES per item (an oversize item is stopped and its partial copy deleted;
// the other items still go through). `dropped` tells JS how many items were skipped (count only).
//
// Nothing here logs anything: no Uri, no text, no file name, no size.
class ShareIntentModule : Module() {
  companion object {
    const val MAX_ITEMS = 10
    const val MAX_ITEM_BYTES = 50L * 1024L * 1024L - 1024L
  }

  private var pendingDropped: Int = 0
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
      var dropped = pendingDropped
      if (uris.isNotEmpty()) {
        val copied = uris.mapNotNull { copyToCache(it) }
        dropped += uris.size - copied.size
        if (copied.isNotEmpty()) out["uris"] = copied
      }
      // Consumed: the Uri grants are single-use from our point of view; a second call returns null.
      pendingText = null
      pendingUris = emptyList()
      pendingDropped = 0
      if (out.isEmpty()) {
        null
      } else {
        if (dropped > 0) out["dropped"] = dropped
        out
      }
    }

    Function("clearPendingShare") {
      pendingText = null
      pendingUris = emptyList()
      pendingDropped = 0
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
    val accepted = uris.distinct().filter { acceptable(it) }
    if (text == null && accepted.isEmpty()) return false
    pendingText = text
    pendingUris = accepted.take(MAX_ITEMS)
    pendingDropped = uris.distinct().size - pendingUris.size
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

  /**
   * content:// only, and not from a provider of our own package (we export none; a URI naming our
   * authority is an attempt to make us read our own files). The sender's read grant is what makes a
   * content Uri safe: the resolver asks the provider, not the file system, in our process.
   */
  private fun acceptable(uri: Uri): Boolean {
    if (uri.scheme != "content") return false
    val authority = uri.authority ?: return false
    val self = appContext.reactContext?.packageName ?: return false
    return !authority.startsWith(self)
  }

  /** Copies one content Uri into the share cache under a random name; null when it cannot be read, is not acceptable or exceeds MAX_ITEM_BYTES. */
  private fun copyToCache(uri: Uri): String? {
    val resolver = appContext.reactContext?.contentResolver ?: return null
    if (!acceptable(uri)) return null
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(uri) ?: "")?.let { ".$it" }
      ?: extensionOf(uri)
    val dir = shareDir()
    if (!dir.exists()) dir.mkdirs()
    val target = File(dir, randomName() + ext)
    return try {
      val input = resolver.openInputStream(uri) ?: return null
      var total = 0L
      var ok = true
      input.use { src ->
        FileOutputStream(target).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val n = src.read(buffer)
            if (n < 0) break
            total += n
            if (total > MAX_ITEM_BYTES) {
              ok = false
              break
            }
            output.write(buffer, 0, n)
          }
        }
      }
      if (!ok || total == 0L) {
        target.delete()
        null
      } else {
        Uri.fromFile(target).toString()
      }
    } catch (_: Exception) {
      target.delete()
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
