package expo.modules.imageresize

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Resize a JPEG file on disk to a target width, preserving aspect ratio,
 * and write the result as a JPEG at the requested quality.
 *
 * Uses Android's built-in BitmapFactory + Bitmap.createScaledBitmap. No
 * Glide, no coroutines, no callback chain — deliberately unlike
 * expo-image-manipulator, whose Glide-backed loader has a double-resume
 * race that surfaces as `IllegalStateException: alreadyResumed` on
 * Android 16 / tight-lifecycle ROMs.
 *
 * `AsyncFunction` dispatches each call to the Expo module background
 * thread automatically.
 */
class ExpoImageResizeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoImageResize")

    AsyncFunction("resizeImageToFileAsync") { sourceUri: String, targetUri: String, maxWidth: Int, quality: Double ->
      val sourcePath = resolvePath(sourceUri)
        ?: throw Exception("Invalid source URI: $sourceUri")
      val targetPath = resolvePath(targetUri)
        ?: throw Exception("Invalid target URI: $targetUri")

      // Two-pass decode: first measure, then load with inSampleSize so
      // we never hold the full-resolution bitmap in memory when maxWidth
      // is much smaller than the source.
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(sourcePath, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        throw Exception("Failed to read image dimensions: $sourcePath")
      }
      val sampleSize = calculateInSampleSize(bounds.outWidth, maxWidth)

      val decodeOpts = BitmapFactory.Options().apply {
        inSampleSize = sampleSize
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      val decoded = BitmapFactory.decodeFile(sourcePath, decodeOpts)
        ?: throw Exception("Failed to decode bitmap: $sourcePath")

      // Scale to exact target width; height preserves aspect ratio.
      val targetWidth = maxWidth.coerceAtLeast(1)
      val aspect = decoded.height.toFloat() / decoded.width.toFloat()
      val targetHeight = (targetWidth * aspect).toInt().coerceAtLeast(1)
      val scaled = if (decoded.width == targetWidth && decoded.height == targetHeight) {
        decoded
      } else {
        Bitmap.createScaledBitmap(decoded, targetWidth, targetHeight, true)
      }

      // Ensure parent directory exists before writing.
      val targetFile = File(targetPath)
      targetFile.parentFile?.mkdirs()

      try {
        FileOutputStream(targetFile).use { out ->
          val q = (quality.coerceIn(0.0, 1.0) * 100).toInt()
          scaled.compress(Bitmap.CompressFormat.JPEG, q, out)
        }
      } finally {
        if (scaled !== decoded) scaled.recycle()
        decoded.recycle()
      }
    }
  }

  private fun resolvePath(uri: String): String? {
    if (uri.startsWith("file://")) {
      return Uri.parse(uri).path
    }
    return uri
  }

  /**
   * Compute a sane inSampleSize for the target width. Android's
   * BitmapFactory only honours powers of 2; `outWidth / maxWidth` rounded
   * down to the nearest power of 2 gives the largest safe step-down
   * without going below the target.
   */
  private fun calculateInSampleSize(sourceWidth: Int, maxWidth: Int): Int {
    if (sourceWidth <= maxWidth || maxWidth <= 0) return 1
    var sample = 1
    while ((sourceWidth / (sample * 2)) >= maxWidth) {
      sample *= 2
    }
    return sample
  }
}
