import Foundation
import ConvexMobile
import Observation

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

/// The Sombrey Coach conversation — the real `ai/sombreyCoach:chat` action,
/// exactly as before (the action is stateless, so the full conversation is
/// resent each turn). Owned by `AppState` so it survives tab changes; no
/// reply is ever fabricated — a failed turn says so and can be retried.
@Observable
@MainActor
final class SombreyCoachConversation {
    private(set) var messages: [ChatMessage] = []
    private(set) var isResponding = false
    /// Set when the last turn failed; the user's message stays and can be retried.
    private(set) var failure: String?
    var draft = ""

    var canSend: Bool {
        !isResponding && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Sends a message (a typed one, or a conversation starter's question).
    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isResponding else { return }
        messages.append(ChatMessage(role: .user, content: trimmed))
        if text == draft { draft = "" }
        requestReply()
    }

    func sendDraft() { send(draft) }

    /// Re-asks after a failed turn, without repeating the user's message.
    func retry() {
        guard failure != nil, messages.last?.role == .user else { return }
        requestReply()
    }

    func reset() {
        messages = []
        draft = ""
        failure = nil
        isResponding = false
    }

    private func requestReply() {
        isResponding = true
        failure = nil
        Task {
            do {
                // `convex-swift` declares exactly one conformance of `Array`
                // to `ConvexEncodable` — `[ConvexEncodable?]` — so each
                // message is boxed to match it.
                let payload: [ConvexEncodable?] = messages.map { $0 as ConvexEncodable? }
                let reply: ChatReply = try await ConvexClientProvider.client.action(
                    "ai/sombreyCoach:chat",
                    with: ["messages": payload]
                )
                messages.append(ChatMessage(role: .assistant, content: reply.reply))
            } catch {
                failure = "Sombrey Coach couldn't answer just now."
            }
            isResponding = false
        }
    }
}
