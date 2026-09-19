import Foundation

/// The subset of Convex's `users` table the client needs early. Matches
/// the fields `convex/users.ts`'s `getById`/`updateCurrentUser` already
/// expose — extend as later phases need more, don't mirror the whole
/// ~45-table schema speculatively.
struct SombreyUser: Identifiable, Decodable {
    let id: String
    let name: String?
    let email: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case email
    }
}
