import SwiftUI
import ConvexMobile

/// Real conversation UI against the existing, working
/// `ai.sombreyCoach:chat` Convex action — behaviorally ported from
/// `apps/mobile/src/screens/AICoachScreen.tsx` (suggestion chips, a
/// scrolling message list, a fixed input bar), not translated 1:1. The
/// action is stateless server-side (see `ChatModels.swift`), so this
/// view owns the conversation array and resends it each turn — same
/// pattern as the web app's `useAiCoach.ts`. No response is ever
/// fabricated; every assistant message is the action's real reply.
struct AICoachScreen: View {
    @Environment(AppState.self) private var appState
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    private let suggestions = [
        "Why is my readiness lower today?",
        "What should I eat before training?",
    ]

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .aiCoach, scrolls: false, selection: $appState.selectedTab) {
            VStack(spacing: 0) {
                Text("Sombrey Coach")
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 20)

                AiDisclosureBadge()
                    .padding(.top, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            emptyState
                        }
                        ForEach(messages) { message in
                            MessageBubble(message: message)
                        }
                        if isSending {
                            ProgressView().tint(StudioColor.ink)
                        }
                        if let errorMessage {
                            Text(errorMessage)
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.danger)
                        }
                    }
                    .padding(.top, 16)
                }

                inputBar
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(suggestions, id: \.self) { suggestion in
                Button(suggestion) {
                    send(suggestion)
                }
                .buttonStyle(.outlineCTA)
            }
        }
        .padding(.top, 24)
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Ask Sombrey…", text: $draft)
                .textFieldStyle(.roundedBorder)
            Button {
                send(draft)
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
        }
        .padding(.vertical, 12)
    }

    private func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let userMessage = ChatMessage(role: .user, content: trimmed)
        messages.append(userMessage)
        draft = ""
        isSending = true
        errorMessage = nil

        Task {
            do {
                // `convex-swift` declares exactly one conformance of `Array`
                // to `ConvexEncodable` — `[ConvexEncodable?]` — and (per the
                // real Codemagic error) rejects a second, app-declared
                // conditional conformance for `[Element: Encodable]` even
                // with non-overlapping bounds. Box each message explicitly
                // to match the library's actual declared conformance.
                let payload: [ConvexEncodable?] = messages.map { $0 as ConvexEncodable? }
                let reply: ChatReply = try await ConvexClientProvider.client.action(
                    "ai/sombreyCoach:chat",
                    with: ["messages": payload]
                )
                messages.append(ChatMessage(role: .assistant, content: reply.reply))
            } catch {
                errorMessage = "Couldn't reach Sombrey Coach: \(error)"
            }
            isSending = false
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .assistant { Spacer(minLength: 0) }
            Text(message.content)
                .font(StudioFont.body(14))
                .foregroundStyle(StudioColor.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(message.role == .user ? StudioColor.env4.opacity(0.7) : StudioColor.env5.opacity(0.5))
                )
            if message.role == .user { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }
}
