import SwiftUI
import PhotosUI
import AVFoundation
import UIKit

/// Settings › Profile — the user's photo, name and email. Uses the account's
/// existing avatar storage (`users:generateAvatarUploadUrl` / `saveAvatar` /
/// `removeAvatar`), so the photo belongs to the authenticated user and
/// nothing else is introduced. Photos are re-encoded to a ~512 px JPEG before
/// upload, which drops location and camera metadata.
struct ProfileSection: View {
    @Environment(AppState.self) private var appState
    @State private var pickerItem: PhotosPickerItem?
    @State private var showingCamera = false
    @State private var busy = false
    @State private var message: String?
    @State private var saved = 0

    private var user: SombreyUser? { appState.currentUser }
    private var hasPhoto: Bool { user?.avatarUrl != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                ProfileAvatar(url: user?.avatarUrl, name: user?.name, size: 72)
                    .overlay {
                        if busy { ProgressView().tint(StudioColor.paper) }
                    }
                VStack(alignment: .leading, spacing: 4) {
                    Text(user?.name ?? "—")
                        .font(StudioFont.body(16, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    Text(user?.email ?? "—")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            }
            // A plain String: PhotosPicker's label closure is Sendable and
            // can't read main-actor view state.
            let pickTitle = hasPhoto ? "Replace photo" : "Choose photo"
            HStack(spacing: 8) {
                PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                    ProfileChip(title: pickTitle, systemImage: "photo")
                }
                .accessibilityIdentifier("settings.profile.choose")
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { requestCamera() } label: { ProfileChip(title: "Take photo", systemImage: "camera") }
                        .accessibilityIdentifier("settings.profile.camera")
                }
                if hasPhoto {
                    Button(role: .destructive) { remove() } label: { ProfileChip(title: "Remove", systemImage: "trash") }
                        .accessibilityIdentifier("settings.profile.remove")
                }
            }
            .buttonStyle(.plain)
            .disabled(busy)
            if let message {
                Text(message)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 6)
        .sensoryFeedback(.success, trigger: saved)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                pickerItem = nil
                guard let data, let image = UIImage(data: data) else { message = "That photo couldn't be read."; return }
                await upload(image)
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { image in
                showingCamera = false
                if let image { Task { await upload(image) } }
            }
            .ignoresSafeArea()
        }
    }

    private func requestCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: showingCamera = true
        case .notDetermined:
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                if granted { showingCamera = true } else { message = "Camera access is off. You can still choose a photo." }
            }
        default:
            message = "Camera access is off for Sombrey in iPhone Settings. You can still choose a photo."
        }
    }

    private func upload(_ image: UIImage) async {
        busy = true
        defer { busy = false }
        do {
            try await ProfilePhotoUpload.upload(image)
            message = nil
            saved += 1
        } catch {
            message = "Couldn't save your photo. Check your connection and try again."
        }
    }

    private func remove() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await ConvexClientProvider.client.mutation("users:removeAvatar")
                message = nil
                saved += 1
            } catch {
                message = "Couldn't remove your photo right now."
            }
        }
    }
}

/// A profile action — glass capsule, 44 pt tall. A View (not a helper
/// method) so it can be built inside PhotosPicker's nonisolated label.
struct ProfileChip: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(StudioFont.body(12, weight: .medium))
            .foregroundStyle(StudioColor.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background {
                Capsule(style: .continuous)
                    .fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .light)
                    .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
            }
    }
}

/// Resizes, re-encodes and uploads a profile photo to the account's avatar
/// storage (the previous photo is deleted server-side by `saveAvatar`).
enum ProfilePhotoUpload {
    static let maxPixel: CGFloat = 512

    /// Square-cropped, ≤ 512 px, JPEG — no EXIF/GPS survives re-encoding.
    static func prepared(_ image: UIImage) -> Data? {
        let side = min(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let target = min(maxPixel, side * image.scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: target, height: target), format: format)
        let rendered = renderer.image { _ in
            let scale = target / side
            let w = image.size.width * scale, h = image.size.height * scale
            image.draw(in: CGRect(x: (target - w) / 2, y: (target - h) / 2, width: w, height: h))
        }
        return rendered.jpegData(compressionQuality: 0.82)
    }

    private struct UploadResponse: Decodable { let storageId: String }

    @MainActor
    static func upload(_ image: UIImage) async throws {
        guard let data = prepared(image) else { throw URLError(.cannotDecodeContentData) }
        let uploadUrl: String = try await ConvexClientProvider.client.mutation("users:generateAvatarUploadUrl")
        guard let url = URL(string: uploadUrl) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let storageId = try JSONDecoder().decode(UploadResponse.self, from: body).storageId
        try await ConvexClientProvider.client.mutation("users:saveAvatar", with: ["storageId": storageId])
    }
}

/// The system camera, for taking a new profile photo.
struct CameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraDevice = .front
        picker.allowsEditing = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void
        init(onFinish: @escaping (UIImage?) -> Void) { self.onFinish = onFinish }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish((info[.editedImage] ?? info[.originalImage]) as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}
