import ExpoModulesCore
import Foundation

public class ExpoBackupExclusionsModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoBackupExclusions")

        AsyncFunction("excludeFromBackup") { (promise: Promise) in
            DispatchQueue.global(qos: .userInitiated).async {
                guard let documents = FileManager.default.urls(
                    for: .documentDirectory,
                    in: .userDomainMask
                ).first else {
                    promise.resolve(nil)
                    return
                }

                for pathComponent in ExcludedPaths.paths {
                    var url = documents.appendingPathComponent(pathComponent)
                    if FileManager.default.fileExists(atPath: url.path) {
                        var resourceValues = URLResourceValues()
                        resourceValues.isExcludedFromBackup = true
                        try? url.setResourceValues(resourceValues)
                    }
                }

                promise.resolve(nil)
            }
        }
    }
}
