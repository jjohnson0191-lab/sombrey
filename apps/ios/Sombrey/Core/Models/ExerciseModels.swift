import Foundation

/// A row from the real, existing `exercises` table
/// (`convex/exercises.ts`'s `list` query — publicly queryable, no
/// coach/program assignment required). Used to build a training session
/// from real exercise data rather than any fabricated "today's plan."
struct Exercise: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let muscleGroup: String

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, description, muscleGroup
    }
}
