import SwiftUI

// MARK: - Hero

/// The Sombrey tab's hero: the Sombrey logo (same treatment as every tab),
/// then "Sombrey Coach" and one restrained line.
struct SombreyCoachHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SombreyLogo(size: .header, tone: .onLight)
            VStack(alignment: .leading, spacing: 4) {
                Text("Sombrey Coach")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Your training, recovery and nutrition — together.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - The glass conversation chamber

/// The conversation lives INSIDE this glass surface: the screen and the
/// surface stay put, only the conversation scrolls, and the composer is
/// part of the surface's floor. Sombrey's words float on the glass; the
/// user's sit in a faint glass slip. A fade at the top and bottom edges
/// makes the history read as floating inside the chamber.
///
/// Scrolling: a new message follows the conversation down only if the user
/// was already at (or near) the bottom — someone reading earlier replies
/// is never yanked away; they get a "Newest" control instead.
/// Vertical scrolling can't turn into a tab swipe (the pager needs a
/// clearly horizontal drag), and the composer's text editing is excluded
/// from the pager entirely.
struct SombreyConversationSurface: View {
    @Bindable var conversation: SombreyCoachConversation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var composerFocused: Bool
    @State private var atBottom = true
    @State private var unseenReply = false

    private static let bottomID = "sombrey.conversation.bottom"

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        if conversation.messages.isEmpty {
                            SombreyConversationStarters { question in
                                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) {
                                    conversation.send(question)
                                }
                            }
                            .transition(.opacity)
                        }
                        ForEach(conversation.messages) { message in
                            SombreyMessageView(message: message)
                                .id(message.id)
                                .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 8)))
                        }
                        if conversation.isResponding {
                            SombreyRespondingIndicator()
                                .transition(.opacity)
                        }
                        if let failure = conversation.failure {
                            SombreyFailureRow(message: failure) { conversation.retry() }
                        }
                        // The floor of the conversation: visible = the user
                        // is at the newest content.
                        Color.clear
                            .frame(height: 1)
                            .id(Self.bottomID)
                            .onAppear { atBottom = true; unseenReply = false }
                            .onDisappear { atBottom = false }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .mask {
                    LinearGradient(stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .black, location: 0.05),
                        .init(color: .black, location: 0.94),
                        .init(color: .clear, location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                }
                .overlay(alignment: .bottom) {
                    if unseenReply && !atBottom {
                        Button {
                            scrollToNewest(proxy)
                        } label: {
                            Label("Newest", systemImage: "arrow.down")
                                .font(StudioFont.body(12, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 44)
                                .background {
                                    Capsule(style: .continuous)
                                        .fill(.ultraThinMaterial)
                                        .environment(\.colorScheme, .light)
                                        .overlay { Capsule(style: .continuous).strokeBorder(Color.white.opacity(0.6), lineWidth: 0.5) }
                                }
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, 8)
                        .transition(.opacity)
                        .accessibilityLabel("Jump to the newest message")
                    }
                }
                .onChange(of: conversation.messages.count) { _, _ in follow(proxy) }
                .onChange(of: conversation.isResponding) { _, _ in follow(proxy) }
                .onChange(of: composerFocused) { _, focused in
                    if focused, atBottom { scrollToNewest(proxy) }
                }
            }
            Rectangle()
                .fill(StudioColor.ink.opacity(0.07))
                .frame(height: 1)
                .padding(.horizontal, 20)
            SombreyComposer(conversation: conversation, focused: $composerFocused)
        }
        .background { SombreyGlassChamber() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sombrey Coach conversation")
        .accessibilityIdentifier("sombrey.conversation")
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("SOMBREY")
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.inkSoft)
            Spacer()
            AiDisclosureBadge(label: "AI-generated · not medical advice")
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 2)
        .accessibilityElement(children: .combine)
    }

    /// Follow the conversation down only if the user is already there.
    private func follow(_ proxy: ScrollViewProxy) {
        if atBottom {
            scrollToNewest(proxy)
        } else if !conversation.messages.isEmpty {
            unseenReply = true
        }
    }

    private func scrollToNewest(_ proxy: ScrollViewProxy) {
        unseenReply = false
        withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
            proxy.scrollTo(Self.bottomID, anchor: .bottom)
        }
    }
}

/// The glass of the chamber — the Studio glass language (a real material,
/// a light from above, a lit rim, a soft separating shadow), in one shape.
struct SombreyGlassChamber: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 30, style: .continuous)
        ZStack {
            shape.fill(.ultraThinMaterial).environment(\.colorScheme, .light)
            shape.fill(LinearGradient(colors: [Color.white.opacity(0.34), Color.white.opacity(0.16)], startPoint: .top, endPoint: .bottom))
            RadialGradient(colors: [Color.white.opacity(0.28), .clear], center: UnitPoint(x: 0.5, y: -0.1), startRadius: 0, endRadius: 320)
                .clipShape(shape)
        }
        .overlay {
            shape.strokeBorder(
                LinearGradient(colors: [Color.white.opacity(0.75), Color.white.opacity(0.2)], startPoint: .top, endPoint: .bottom),
                lineWidth: 1
            )
        }
        .shadow(color: StudioColor.env0.opacity(0.14), radius: 24, y: 12)
    }
}

// MARK: - Messages

/// One turn. Sombrey's words float on the glass, unboxed; the user's sit in
/// a faint glass slip, right-aligned. Long-press to copy.
struct SombreyMessageView: View {
    let message: ChatMessage

    var body: some View {
        switch message.role {
        case .assistant:
            VStack(alignment: .leading, spacing: 6) {
                Text("Sombrey")
                    .font(StudioFont.body(11, weight: .semibold))
                    .foregroundStyle(StudioColor.inkSoft)
                Text(message.content)
                    .font(StudioFont.body(15))
                    .foregroundStyle(StudioColor.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contextMenu { copyButton }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Sombrey: \(message.content)")
        case .user:
            HStack {
                Spacer(minLength: 48)
                Text(message.content)
                    .font(StudioFont.body(15))
                    .foregroundStyle(StudioColor.ink)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(StudioColor.ink.opacity(0.05))
                            .overlay {
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.7), lineWidth: 0.5)
                            }
                    }
            }
            .contextMenu { copyButton }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("You: \(message.content)")
        }
    }

    private var copyButton: some View {
        Button {
            UIPasteboard.general.string = message.content
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
    }
}

/// While Sombrey is answering — three quiet marks breathing in turn (still
/// under Reduce Motion). The existing Coach returns whole replies, so this
/// is a real waiting state, not a fake stream.
struct SombreyRespondingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false

    var body: some View {
        HStack(spacing: 8) {
            Text("Sombrey")
                .font(StudioFont.body(11, weight: .semibold))
                .foregroundStyle(StudioColor.inkSoft)
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(StudioColor.ink.opacity(0.45))
                        .frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 0.6 : (phase ? 1 : 0.25))
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.7).repeatForever().delay(Double(i) * 0.18), value: phase)
                }
            }
        }
        .onAppear { phase = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sombrey is responding")
    }
}

/// A turn that failed — said plainly, with a retry. Nothing is invented.
struct SombreyFailureRow: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(message)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.danger)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Try again", action: retry)
                .font(StudioFont.body(13, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .frame(minHeight: 44)
        }
    }
}

// MARK: - Empty state

/// Before the first message: what Sombrey can help with, and four starters.
/// A starter SENDS its question into the real Coach conversation — it isn't
/// navigation and nothing is pre-answered.
struct SombreyConversationStarters: View {
    let start: (String) -> Void

    static let starters: [(label: String, question: String)] = [
        ("Today's training", "What should I focus on in today's training?"),
        ("Recovery", "How recovered am I today, and what does that mean for training?"),
        ("Nutrition", "How is my nutrition supporting my training?"),
        ("My progress", "How am I progressing lately?"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What can Sombrey help with?")
                .font(StudioFont.hero(20, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(Self.starters, id: \.label) { starter in
                    Button { start(starter.question) } label: {
                        Text(starter.label)
                            .font(StudioFont.body(13, weight: .medium))
                            .foregroundStyle(StudioColor.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background {
                                Capsule(style: .continuous)
                                    .fill(Color.white.opacity(0.42))
                                    .overlay { Capsule(style: .continuous).strokeBorder(Color.white.opacity(0.7), lineWidth: 0.5) }
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Asks Sombrey Coach: \(starter.question)")
                }
            }
        }
        .padding(.top, 8)
    }
}

// MARK: - Composer

/// The floor of the chamber: a growing text field ("Ask Sombrey…") and a
/// lit send control in the illuminated-glass language — dim when there's
/// nothing to send, a quiet spinner while Sombrey answers.
struct SombreyComposer: View {
    @Bindable var conversation: SombreyCoachConversation
    var focused: FocusState<Bool>.Binding
    @State private var sends = 0

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask Sombrey…", text: $conversation.draft, axis: .vertical)
                .font(StudioFont.body(15))
                .foregroundStyle(StudioColor.ink)
                .lineLimit(1...5)
                .focused(focused)
                .padding(.vertical, 12)
                .frame(minHeight: 44)
                .primaryNavigationExclusion()
                .accessibilityLabel("Message Sombrey Coach")
                .accessibilityIdentifier("sombrey.composer")
            Button {
                sends += 1
                conversation.sendDraft()
            } label: {
                ZStack {
                    Circle().fill(.thinMaterial).environment(\.colorScheme, .light)
                    if conversation.canSend {
                        RadialGradient(colors: [Color.white.opacity(0.55), .clear], center: UnitPoint(x: 0.5, y: 0.1), startRadius: 0, endRadius: 30)
                            .clipShape(Circle())
                    }
                    if conversation.isResponding {
                        ProgressView().controlSize(.small).tint(StudioColor.ink)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(conversation.canSend ? StudioColor.ink : StudioColor.inkFaint)
                    }
                }
                .frame(width: 38, height: 38)
                .overlay { Circle().strokeBorder(Color.white.opacity(conversation.canSend ? 0.8 : 0.4), lineWidth: 0.75) }
                .shadow(color: StudioColor.env0.opacity(conversation.canSend ? 0.18 : 0), radius: 6, y: 3)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!conversation.canSend)
            .sensoryFeedback(StudioHaptic.focus, trigger: sends)
            .accessibilityLabel(conversation.isResponding ? "Sombrey is responding" : "Send")
            .accessibilityIdentifier("sombrey.send")
        }
        .padding(.leading, 20)
        .padding(.trailing, 10)
        .padding(.vertical, 6)
    }
}
