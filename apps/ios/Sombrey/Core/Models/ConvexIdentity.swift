import Foundation

/// The subset of Convex's `users` table the client needs early. Matches
/// the fields `convex/users.ts`'s `getById`/`updateCurrentUser` already
/// expose — extend as later phases need more, don't mirror the whole
/// ~45-table schema speculatively.
struct SombreyUser: Identifiable, Decodable {
    let id: String
    let name: String?
    let email: String?
    /// Added in the Phase 3 training-architecture expansion —
    /// "full_control" / "recommendations" / "tracking_only". `nil`
    /// means the user hasn't set one yet; treat as "recommendations".
    let coachingMode: String?
    /// The user's profile photo (Convex storage URL), nil when there is none.
    var avatarUrl: String? = nil

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case email
        case coachingMode
        case avatarUrl
    }
}
