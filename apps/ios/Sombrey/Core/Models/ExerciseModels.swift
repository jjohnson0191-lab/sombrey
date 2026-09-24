import Foundation

/// A Sombrey exercise as training uses it — a session, a plan, a logged set.
/// `id` is the stable Sombrey exercise id (`exercises` table), never an
/// external provider's. The optional fields came later; they decode as
/// absent from older saved sessions.
struct Exercise: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let muscleGroup: String
    var primaryMuscles: [String]? = nil
    var equipment: [String]? = nil
    var difficulty: String? = nil

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, description, muscleGroup, primaryMuscles, equipment, difficulty
    }
}
