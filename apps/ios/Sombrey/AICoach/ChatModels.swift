import Foundation

/// Mirrors `convex/ai/sombreyCoach.ts`'s `chat` action exactly: role is
/// either "user" or "assistant", the action is stateless (no server-side
/// history) — the client resends the full conversation each turn, same
/// as `apps/mobile`'s `useAiCoach.ts`.
struct ChatMessage: Encodable, ConvexEncodable, Identifiable, Equatable {
    enum Role: String, Encodable { case user, assistant }

    let id = UUID()
    let role: Role
    let content: String

    /// Only `role`/`content` are sent to Convex — `id` is client-only,
    /// so it's simply not in this Encodable's `CodingKeys`.
    enum CodingKeys: String, CodingKey { case role, content }
}

/// `{ reply: String }` — the action's exact return shape.
struct ChatReply: Decodable {
    let reply: String
}
