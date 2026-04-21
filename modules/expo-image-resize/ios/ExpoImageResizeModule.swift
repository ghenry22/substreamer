import ExpoModulesCore
import Foundation
import UIKit

public class ExpoImageResizeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoImageResize")

    // Resize a local JPEG to `maxWidth` pixels wide (aspect-preserving)
    // and write the result as a JPEG at `quality` to `targetUri`.
    // `AsyncFunction` dispatches this to a background queue automatically.
    AsyncFunction("resizeImageToFileAsync") { (sourceUri: String, targetUri: String, maxWidth: Int, quality: Double) in
      let sourcePath = Self.resolvePath(sourceUri)
      let targetPath = Self.resolvePath(targetUri)

      guard let source = UIImage(contentsOfFile: sourcePath) else {
        throw ResizeError.decodeFailed(sourcePath)
      }
      guard source.size.width > 0, source.size.height > 0 else {
        throw ResizeError.invalidDimensions
      }

      let targetWidth = CGFloat(max(1, maxWidth))
      let aspect = source.size.height / source.size.width
      let targetSize = CGSize(
        width: targetWidth,
        height: max(1, (targetWidth * aspect).rounded())
      )

      // Scale 1 keeps output pixel count == targetSize; the default scale
      // uses screen DPI which would produce 2x or 3x larger bitmaps than
      // we want for our disk cache.
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
      let resized = renderer.image { _ in
        source.draw(in: CGRect(origin: .zero, size: targetSize))
      }

      let clampedQuality = CGFloat(max(0.0, min(1.0, quality)))
      guard let data = resized.jpegData(compressionQuality: clampedQuality) else {
        throw ResizeError.encodeFailed
      }

      // Ensure parent directory exists before writing.
      let targetUrl = URL(fileURLWithPath: targetPath)
      try? FileManager.default.createDirectory(
        at: targetUrl.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try data.write(to: targetUrl)
    }
  }

  private static func resolvePath(_ uri: String) -> String {
    if uri.hasPrefix("file://") {
      return URL(string: uri)?.path ?? String(uri.dropFirst("file://".count))
    }
    return uri
  }
}

private enum ResizeError: Error, LocalizedError {
  case decodeFailed(String)
  case encodeFailed
  case invalidDimensions

  var errorDescription: String? {
    switch self {
    case .decodeFailed(let path): return "Failed to decode image at \(path)"
    case .encodeFailed: return "Failed to encode JPEG"
    case .invalidDimensions: return "Source image has zero dimensions"
    }
  }
}
