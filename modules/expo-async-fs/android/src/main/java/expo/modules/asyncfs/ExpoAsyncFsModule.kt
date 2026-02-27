package expo.modules.asyncfs

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class ExpoAsyncFsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAsyncFs")

    // Runs on a native background thread automatically via AsyncFunction.
    AsyncFunction("listDirectoryAsync") { uri: String ->
      val path = Uri.parse(uri).path ?: return@AsyncFunction emptyList<String>()
      File(path).list()?.toList() ?: emptyList()
    }

    // Recursively sums file sizes under the given directory.
    AsyncFunction("getDirectorySizeAsync") { uri: String ->
      val path = Uri.parse(uri).path ?: return@AsyncFunction 0L
      directorySize(File(path))
    }
  }

  private fun directorySize(dir: File): Long {
    if (!dir.exists()) return 0
    return dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
  }
}
