import ExpoModulesCore
import Foundation

public class ExpoAsyncFsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoAsyncFs")

    // Runs on a native background thread automatically via AsyncFunction.
    AsyncFunction("listDirectoryAsync") { (uri: String) -> [String] in
      guard let url = URL(string: uri) else { return [] }
      let contents = try FileManager.default.contentsOfDirectory(atPath: url.path)
      return contents
    }

    // Recursively sums file sizes under the given directory.
    AsyncFunction("getDirectorySizeAsync") { (uri: String) -> Int in
      guard let url = URL(string: uri) else { return 0 }
      return Self.directorySize(at: url)
    }
  }

  private static func directorySize(at url: URL) -> Int {
    let fm = FileManager.default
    guard let enumerator = fm.enumerator(
      at: url,
      includingPropertiesForKeys: [.fileSizeKey],
      options: [.skipsHiddenFiles]
    ) else { return 0 }

    var total = 0
    for case let fileURL as URL in enumerator {
      total += (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
    return total
  }
}
