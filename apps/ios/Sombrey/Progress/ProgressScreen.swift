import SwiftUI
import Charts
import ConvexMobile

/// Real data only: `measurements:list` and `progressPhotos:list` are the
/// same existing, unmodified Convex queries `apps/mobile`'s
/// ProgressScreen already uses. Training history has no real backend
/// source yet (see the migration plan's Convex audit — `workoutLogs` is
/// coach-program-shaped, not reused), so it stays an honest empty state
/// rather than a populated-looking chart.
struct ProgressScreen: View {
    @Environment(AppState.self) private var appState
    @State private var measurements = ConvexQuery<[MeasurementEntry]>()
    @State private var photos = ConvexQuery<[ProgressPhotoEntry]>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .progress, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 28) {
                Text("Progress")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                weightSection
                photosSection
                trainingHistorySection
            }
            .padding(.bottom, 24)
        }
        .task {
            measurements.subscribe(to: "measurements:list")
            photos.subscribe(to: "progressPhotos:list")
        }
    }

    @ViewBuilder
    private var weightSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WEIGHT")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)

            if measurements.isLoading {
                ProgressView().tint(StudioColor.ink)
            } else if let error = measurements.errorMessage {
                Text("Couldn't load measurements: \(error)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.danger)
            } else {
                let entries = (measurements.value ?? []).filter { $0.weight != nil }
                if let latest = entries.last, let weight = latest.weight {
                    HeroNumberText(text: String(format: "%.1f", weight), size: .md, tone: .ink)
                    Text("kg · most recent entry")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                if entries.count > 1 {
                    Chart(entries) { entry in
                        LineMark(
                            x: .value("Date", Date(timeIntervalSince1970: entry.date / 1000)),
                            y: .value("Weight", entry.weight ?? 0)
                        )
                        .foregroundStyle(StudioColor.accentInk)
                        .interpolationMethod(.monotone)
                    }
                    .chartYAxis { AxisMarks(position: .trailing) }
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                    .frame(height: 140)
                    .padding(.top, 4)
                } else if entries.isEmpty {
                    Text("No weight entries logged yet.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
        }
    }

    @ViewBuilder
    private var photosSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("PROGRESS PHOTOS")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            let count = photos.value?.count ?? 0
            Text(count > 0 ? "\(count) photo(s) logged" : "No progress photos yet.")
                .font(StudioFont.body(13))
                .foregroundStyle(count > 0 ? StudioColor.ink : StudioColor.inkFaint)
        }
    }

    private var trainingHistorySection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("TRAINING HISTORY")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            Text("Not tracked yet — training history is coming in a later phase.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkFaint)
        }
    }
}
