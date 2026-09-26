import SwiftUI

// MARK: - Gesture priority

/// Screen regions whose own horizontal interaction wins over tab paging —
/// chart scrubbing, horizontal scrollers and pickers, drag-driven dials, the
/// RPE selector, the AI composer. A drag that STARTS inside one never pages.
///
/// Priority, as specified: (1) the control under the finger, (2) a
/// component's own horizontal interaction, (3) tab paging, (4) nothing when
/// the direction is ambiguous. (1)–(2) are these regions; (4) is the
/// direction test in `PrimaryPager`.
///
/// A plain reference type, not observable: frames are read only when a drag
/// begins, so updating them never re-renders anything.
@MainActor
final class PrimaryNavigationExclusions {
    private var frames: [UUID: CGRect] = [:]

    func set(_ id: UUID, _ frame: CGRect) { frames[id] = frame }
    func remove(_ id: UUID) { frames[id] = nil }
    func contains(_ point: CGPoint) -> Bool { frames.values.contains { $0.insetBy(dx: -4, dy: -4).contains(point) } }
}

private struct PrimaryNavigationExclusionsKey: EnvironmentKey {
    static let defaultValue: PrimaryNavigationExclusions? = nil
}

extension EnvironmentValues {
    var primaryNavigationExclusions: PrimaryNavigationExclusions? {
        get { self[PrimaryNavigationExclusionsKey.self] }
        set { self[PrimaryNavigationExclusionsKey.self] = newValue }
    }
}

private struct PrimaryNavigationExclusion: ViewModifier {
    @Environment(\.primaryNavigationExclusions) private var exclusions
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content.background {
            GeometryReader { geo in
                let frame = geo.frame(in: .global)
                Color.clear
                    .onAppear { exclusions?.set(id, frame) }
                    .onChange(of: frame) { _, new in exclusions?.set(id, new) }
                    .onDisappear { exclusions?.remove(id) }
            }
        }
    }
}

extension View {
    /// Marks this view's horizontal interaction as taking priority over the
    /// swipe between primary tabs.
    func primaryNavigationExclusion() -> some View { modifier(PrimaryNavigationExclusion()) }
}

// MARK: - Interactive paging

/// The swipe between the five primary tabs — an additional way to move,
/// never the only one (the tab bar stays). The current screen follows the
/// finger and the neighbour slides in beside it; release past a third of
/// the width (or with enough velocity) commits, otherwise both spring back.
/// A haptic marks the moment the swipe will commit. Only the current and
/// the neighbour being revealed exist at once (screens are rebuilt per tab
/// anyway), and a committed neighbour keeps its identity, so nothing
/// reloads.
enum PrimaryPager {
    /// Horizontal travel before a drag can become a page (points).
    static let engageDistance: CGFloat = 14
    /// How much more horizontal than vertical a drag must be.
    static let directionRatio: CGFloat = 1.6
    /// Fraction of the width that commits on release.
    static let commitFraction: CGFloat = 0.34
    /// Predicted (velocity-projected) fraction that commits a flick.
    static let flickFraction: CGFloat = 0.6

    enum Decision: Equatable { case undecided, paging, ignored }

    /// Whether a drag in progress should become a tab swipe.
    static func decide(translation: CGSize, startsInExcludedRegion: Bool) -> Decision {
        if startsInExcludedRegion { return .ignored }
        let dx = abs(translation.width), dy = abs(translation.height)
        if dx >= engageDistance && dx > dy * directionRatio { return .paging }
        if dy >= engageDistance || (dx >= engageDistance * 2) { return .ignored } // vertical, or ambiguous
        return .undecided
    }

    /// The neighbour a horizontal drag reveals: dragging left reveals the next tab.
    static func neighbour(of tab: SombreyTab, dragWidth: CGFloat) -> SombreyTab? {
        let tabs = SombreyTab.allCases
        guard let i = tabs.firstIndex(of: tab) else { return nil }
        let j = dragWidth < 0 ? i + 1 : i - 1
        return tabs.indices.contains(j) ? tabs[j] : nil
    }

    /// Displacement shown for a raw drag: 1:1 toward a neighbour, heavily
    /// resisted past the first/last tab.
    static func displayed(dragWidth: CGFloat, hasNeighbour: Bool) -> CGFloat {
        hasNeighbour ? dragWidth : dragWidth * 0.22
    }

    static func commits(dragWidth: CGFloat, predictedWidth: CGFloat, width: CGFloat, hasNeighbour: Bool) -> Bool {
        guard hasNeighbour, width > 0 else { return false }
        let sameDirection = dragWidth.sign == predictedWidth.sign || predictedWidth == 0
        return sameDirection && (abs(dragWidth) >= width * commitFraction || abs(predictedWidth) >= width * flickFraction)
    }
}
