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
                HStack(alignment: .firstTextBaseline) {
                    Text("Sombrey AI")
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    Spacer()
                }
                .padding(.top, 20)

                AISectionControl(selection: $appState.aiSection)
                    .padding(.top, 10)

                switch appState.aiSection {
                case .coach:
                    coach
                case .nutrition:
                    NutritionPanel()
                }
            }
        }
    }

    /// The conversation — Sombrey Coach, with its AI disclosure.
    private var coach: some View {
        VStack(spacing: 0) {
            AiDisclosureBadge()
                .padding(.top, 10)
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
                .primaryNavigationExclusion()
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

/// The AI tab's sections in the navigation-tick grammar — a lit mark over
/// the active one. Nutrition is a first-class part of AI, never a chat
/// command.
private struct AISectionControl: View {
    @Binding var selection: AppState.AISection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var markSpace

    var body: some View {
        HStack(spacing: 24) {
            ForEach(AppState.AISection.allCases) { section in
                let isActive = section == selection
                Button {
                    withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
                        selection = section
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(section.rawValue.uppercased())
                            .font(StudioFont.body(11, weight: isActive ? .semibold : .medium))
                            .tracking(1.3)
                            .foregroundStyle(isActive ? StudioColor.ink : StudioColor.inkSoft)
                        ZStack(alignment: .leading) {
                            Capsule().fill(StudioColor.ink.opacity(0.12)).frame(width: 12, height: 3)
                            if isActive {
                                Capsule()
                                    .fill(StudioColor.accentInk)
                                    .frame(width: 22, height: 3)
                                    .matchedGeometryEffect(id: "aiSection", in: markSpace)
                            }
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isActive ? .isSelected : [])
            }
            Spacer()
        }
        .sensoryFeedback(StudioHaptic.rangeChange, trigger: selection)
    }
}
