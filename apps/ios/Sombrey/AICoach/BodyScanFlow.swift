import SwiftUI
import PhotosUI
import UIKit

// MARK: - Data

/// `progressPhotos:list` — a body scan is the views captured together
/// (same `scanId`). The URL is only for the owner (the query is owner-only).
struct ProgressPhotoDTO: Decodable, Equatable, Identifiable {
    let id: String
    let date: Double
    let view: String            // front | side | back
    let scanId: String?
    let url: String?

    enum CodingKeys: String, CodingKey { case id = "_id", date, view, scanId, url }
}

/// `measurements:list` — only the fields the scan results read.
struct BodyMeasurementDTO: Decodable, Equatable {
    let date: Double
    let weight: Double?
    let bodyFat: Double?
    let leanMassKg: Double?
    let source: String?
}

/// One body scan: its views, when it was captured.
struct BodyScan: Identifiable, Equatable {
    let id: String
    let date: Date
    let photos: [ProgressPhotoDTO]

    func photo(_ view: String) -> ProgressPhotoDTO? { photos.first { $0.view == view } }

    /// Scans, newest first, from the user's progress photos (only photos
    /// captured as part of a Body Scan — ordinary progress photos aren't).
    static func group(_ photos: [ProgressPhotoDTO]) -> [BodyScan] {
        Dictionary(grouping: photos.filter { $0.scanId != nil }, by: { $0.scanId! })
            .map { id, views in
                BodyScan(id: id, date: Date(timeIntervalSince1970: (views.map(\.date).min() ?? 0) / 1000), photos: views.sorted { order($0.view) < order($1.view) })
            }
            .sorted { $0.date > $1.date }
    }

    static let views = ["front", "side", "back"]
    static func order(_ view: String) -> Int { views.firstIndex(of: view) ?? 9 }
}

// MARK: - Entry (Sombrey Coach)

/// Body Scan's doorway in Sombrey Coach — with what Sombrey already knows
/// (the last scan), never an invented reading.
struct BodyScanEntry: View {
    let scans: [BodyScan]
    let open: () -> Void

    var body: some View {
        SombreyFeatureEntry(
            eyebrow: "BODY SCAN",
            title: "Track your physique",
            detail: "Front, side and back — compared with your own history.",
            status: scans.first.map { "Last scan \($0.date.formatted(.dateTime.day().month(.abbreviated)))" } ?? "No scans yet",
            glyph: "viewfinder",
            action: open
        )
        .accessibilityIdentifier("sombrey.bodyScanEntry")
    }
}

// MARK: - Flow

/// Body Scan: guidance → front, side, (back) → saved privately → results.
///
/// What it is, honestly: a consistent, private photo record of your
/// physique for side-by-side comparison. Photos are stored in your account
/// (Sombrey's storage, visible only to you), resized and re-encoded first
/// (no location/camera data), and are NOT sent to any AI service. Sombrey
/// doesn't estimate body fat or lean mass from photos — there's no validated
/// method for it here — so the results only ever show measurements that
/// were actually recorded, each with its source.
struct BodyScanFlow: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Stage: Equatable { case intro, capture(Int), saving, results }

    @State private var stage: Stage
    @State private var captured: [String: UIImage] = [:]
    @State private var showingCamera = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var problem: String?
    @State private var savedTick = 0

    init(startWithResults: Bool = false) {
        _stage = State(initialValue: startWithResults ? .results : .intro)
    }

    var body: some View {
        EnvironmentView(scene: .aiCoach) {
            VStack(spacing: 0) {
                HStack {
                    Button(stage == .results ? "Done" : "Cancel") { dismiss() }
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                        .frame(minHeight: 44)
                    Spacer()
                    SombreyLogo(size: .header, tone: .onLight)
                    Spacer()
                    Color.clear.frame(width: 60, height: 44)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                switch stage {
                case .intro: ScrollView { intro.padding(.horizontal, 24).padding(.bottom, 32) }
                case .capture(let index): ScrollView { capture(index).padding(.horizontal, 24).padding(.bottom, 32) }
                case .saving: saving
                case .results: BodyScanResultsView(onNewScan: { withAnimation { captured = [:]; stage = .intro } })
                }
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker(device: .rear, allowsEditing: false) { image in
                showingCamera = false
                if let image { accept(image) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                pickerItem = nil
                if let data, let image = UIImage(data: data) { accept(image) } else { problem = "That photo couldn't be read." }
            }
        }
        .sensoryFeedback(.success, trigger: savedTick)
    }

    // MARK: Intro

    private var intro: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("BODY SCAN")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                Text("Track your physique")
                    .font(StudioFont.hero(30, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Three photos — front, side and back — taken the same way each time, so you can see how you're changing against your own history.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 16)

            VStack(alignment: .leading, spacing: 10) {
                guidance("sun.max", "Even, bright light from the front; no strong shadows")
                guidance("rectangle.portrait", "A plain background, your whole body in frame")
                guidance("ruler", "Phone at chest height, about 2 m away — ask someone, or use a timer and choose the photo from your library")
                guidance("tshirt", "Fitted clothing, the same each time; stand relaxed, arms slightly away from your body")
            }

            Text("Your photos are stored privately in your account, only for your own comparison. They aren't sent to any AI service, and Sombrey doesn't estimate body fat from them. You can delete a scan at any time.")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)

            Button { withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .capture(0) } } label: {
                Text("Begin scan").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .accessibilityIdentifier("bodyScan.begin")
        }
    }

    private func guidance(_ glyph: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: glyph)
                .font(.system(size: 13))
                .foregroundStyle(StudioColor.inkSoft)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(text)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Capture

    private func capture(_ index: Int) -> some View {
        let view = BodyScan.views[index]
        return VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(index + 1) OF 3")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                Text(view.capitalized)
                    .font(StudioFont.hero(30, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text(Self.instruction(view))
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 16)

            ZStack {
                if let image = captured[view] {
                    Image(uiImage: image).resizable().scaledToFit()
                } else {
                    // A quiet silhouette frame: where the body goes.
                    Image(systemName: view == "side" ? "figure.stand.line.dotted.figure.stand" : "figure.stand")
                        .font(.system(size: 120, weight: .ultraLight))
                        .foregroundStyle(StudioColor.ink.opacity(0.18))
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 320)
            .background { SombreyGlassChamber(cornerRadius: 24) }
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .accessibilityLabel(captured[view] == nil ? "No \(view) photo yet" : "\(view.capitalized) photo taken")

            if let problem {
                Text(problem)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.danger)
            }

            VStack(spacing: 10) {
                if captured[view] != nil {
                    Button { next(from: index) } label: {
                        Text(index == 2 ? "Save scan" : "Use photo").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .accessibilityIdentifier("bodyScan.usePhoto")
                    Button("Retake") { captured[view] = nil }
                        .buttonStyle(.outlineCTA)
                } else {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { problem = nil; showingCamera = true } label: {
                            Label("Take photo", systemImage: "camera").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.illuminatedCTA)
                    }
                    PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                        Text("Choose from library").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.outlineCTA)
                    if view == "back" {
                        Button("Skip the back view") { save() }
                            .font(StudioFont.body(13, weight: .medium))
                            .foregroundStyle(StudioColor.inkSoft)
                            .frame(minHeight: 44)
                    }
                }
            }
        }
    }

    private static func instruction(_ view: String) -> String {
        switch view {
        case "front": return "Face the camera, feet hip-width apart, arms relaxed slightly away from your sides."
        case "side": return "Turn to your right, arms relaxed by your sides, looking straight ahead."
        default: return "Turn your back to the camera, same stance as the front."
        }
    }

    private var currentView: String? {
        if case .capture(let i) = stage { return BodyScan.views[i] }
        return nil
    }

    private func accept(_ image: UIImage) {
        guard let view = currentView else { return }
        // Downscaled at once — full-resolution camera images aren't held.
        guard let data = SombreyImage.prepared(image, maxPixel: 1600, quality: 0.82), let small = UIImage(data: data) else {
            problem = "That photo couldn't be prepared."
            return
        }
        problem = nil
        captured[view] = small
    }

    private func next(from index: Int) {
        if index < 2 {
            withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .capture(index + 1) }
        } else {
            save()
        }
    }

    // MARK: Saving

    private var saving: some View {
        VStack(spacing: 14) {
            Spacer()
            ProgressView().tint(StudioColor.ink)
            Text("Saving your scan…")
                .font(StudioFont.hero(22, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func save() {
        guard captured["front"] != nil, captured["side"] != nil else {
            problem = "Front and side views are needed."
            return
        }
        stage = .saving
        let scanId = UUID().uuidString
        let date = Date().timeIntervalSince1970 * 1000
        let photos = BodyScan.views.compactMap { view in captured[view].map { (view, $0) } }
        Task {
            do {
                for (view, image) in photos {
                    guard let data = image.jpegData(compressionQuality: 0.82) else { continue }
                    let storageId = try await SombreyImage.upload(data, uploadUrlMutation: "progressPhotos:generateUploadUrl")
                    let _: String = try await ConvexClientProvider.client.mutation("progressPhotos:create", with: [
                        "storageId": storageId, "date": date, "view": view, "scanId": scanId,
                    ])
                }
                captured = [:]
                savedTick += 1
                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .results }
            } catch {
                problem = "Couldn't save the scan. Check your connection and try again."
                stage = .capture(2)
            }
        }
    }
}

// MARK: - Results

/// The latest scan against any earlier one, view by view; what's actually
/// been measured (with its source); and what this scan is and isn't.
struct BodyScanResultsView: View {
    let onNewScan: () -> Void
    @State private var photos = ConvexQuery<[ProgressPhotoDTO]>()
    @State private var measurements = ConvexQuery<[BodyMeasurementDTO]>()
    @State private var view = "front"
    @State private var compareId: String?
    @State private var confirmingDelete = false

    private var scans: [BodyScan] { BodyScan.group(photos.value ?? []) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let latest = scans.first {
                    header(latest)
                    comparison(latest)
                    composition
                    about
                    Button("Delete this scan", role: .destructive) { confirmingDelete = true }
                        .font(StudioFont.body(13, weight: .medium))
                        .frame(minHeight: 44)
                        .confirmationDialog("Delete this scan's photos?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                            Button("Delete", role: .destructive) { delete(latest) }
                        }
                } else if photos.isLoading {
                    ProgressView().tint(StudioColor.ink).padding(.top, 60).frame(maxWidth: .infinity)
                } else {
                    Text("No scans yet.")
                        .font(StudioFont.hero(22, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .padding(.top, 40)
                }
                Button { onNewScan() } label: { Text("New scan").frame(maxWidth: .infinity) }
                    .buttonStyle(.illuminatedCTA)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .task {
            photos.subscribe(to: "progressPhotos:list")
            measurements.subscribe(to: "measurements:list")
        }
    }

    private func header(_ scan: BodyScan) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("BODY SCAN")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.inkSoft)
            Text(scan.date.formatted(.dateTime.day().month(.wide).year()))
                .font(StudioFont.hero(30, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text("\(scan.photos.count) views · stored privately in your account")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
        }
        .padding(.top, 16)
    }

    private func comparison(_ latest: BodyScan) -> some View {
        let earlier = scans.dropFirst()
        let other = earlier.first { $0.id == compareId } ?? earlier.first
        return VStack(alignment: .leading, spacing: 12) {
            StudioModePills(
                options: BodyScan.views.map { StudioModeOption(value: $0, label: $0.uppercased(), accessibilityLabel: "\($0.capitalized) view") },
                selection: $view
            )
            HStack(spacing: 10) {
                scanImage(latest.photo(view), caption: "This scan")
                if let other {
                    scanImage(other.photo(view), caption: other.date.formatted(.dateTime.day().month(.abbreviated).year()))
                }
            }
            if other == nil {
                Text("Your next scan appears here beside this one.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkFaint)
            } else if earlier.count > 1 {
                Menu {
                    ForEach(Array(earlier)) { scan in
                        Button(scan.date.formatted(.dateTime.day().month(.abbreviated).year())) { compareId = scan.id }
                    }
                } label: {
                    Label("Compare with another scan", systemImage: "arrow.left.arrow.right")
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                        .frame(minHeight: 44)
                }
            }
        }
    }

    private func scanImage(_ photo: ProgressPhotoDTO?, caption: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                if let url = photo?.url {
                    ProgressPhotoImage(url: url)
                } else {
                    Text("No \(view) view")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 260)
            .background { SombreyGlassChamber(cornerRadius: 20) }
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            Text(caption)
                .font(StudioFont.body(11, weight: .medium))
                .foregroundStyle(StudioColor.inkSoft)
        }
    }

    /// Only what was actually recorded — with where it came from.
    private var composition: some View {
        let rows = (measurements.value ?? []).sorted { $0.date > $1.date }
        let weight = rows.first { $0.weight != nil }
        let bodyFat = rows.first { $0.bodyFat != nil }
        let lean = rows.first { $0.leanMassKg != nil }
        return VStack(alignment: .leading, spacing: 12) {
            Text("BODY COMPOSITION")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.inkSoft)
            if weight == nil && bodyFat == nil && lean == nil {
                Text("Nothing measured yet. Log your weight in Progress › Body; body fat and lean mass appear when a measured source provides them.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let w = weight?.weight { compositionRow("Weight", String(format: "%.1f kg", w), weight!) }
            if let bf = bodyFat?.bodyFat { compositionRow("Body fat", String(format: "%.1f%%", bf), bodyFat!) }
            if let lm = lean?.leanMassKg { compositionRow("Lean mass", String(format: "%.1f kg", lm), lean!) }
        }
    }

    private func compositionRow(_ label: String, _ value: String, _ row: BodyMeasurementDTO) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(StudioFont.body(13, weight: .medium))
                .foregroundStyle(StudioColor.ink)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(value)
                    .font(StudioFont.hero(20, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("\(ProgressProvenance.label(row.source ?? "manual") ?? "Recorded") · \(Date(timeIntervalSince1970: row.date / 1000).formatted(.dateTime.day().month(.abbreviated)))")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ABOUT THIS SCAN")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.inkSoft)
            Text("A body scan is a consistent photo record for comparing yourself over time. It isn't a measurement: Sombrey doesn't estimate body fat or lean mass from photos. The values above come from their own sources, shown beside each one.")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func delete(_ scan: BodyScan) {
        Task {
            for photo in scan.photos {
                try? await ConvexClientProvider.client.mutation("progressPhotos:remove", with: ["id": photo.id])
            }
        }
    }
}

/// A private progress photo, loaded from its owner-only URL — memory only,
/// never the disk cache.
struct ProgressPhotoImage: View {
    let url: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ProgressView().tint(StudioColor.ink)
            }
        }
        .task(id: url) { image = await ProfileImageCache.shared.privateImage(for: url) }
    }
}
