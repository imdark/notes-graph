import Foundation

final class AppConfigManager {
  struct AppConfig: Decodable {
    let notesgraphVersion: String
  }

  static var notesgraphVersion: String?

  static func getNotesGraphVersion() -> String {
    if notesgraphVersion == nil {
      let file = Bundle(for: AppConfigManager.self).url(forResource: "capacitor.config", withExtension: "json")!
      let data = try! Data(contentsOf: file)
      let config = try! JSONDecoder().decode(AppConfig.self, from: data)
      notesgraphVersion = config.notesgraphVersion
    }

    return notesgraphVersion!
  }
}
