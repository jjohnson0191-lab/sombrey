import SwiftUI
import UIKit

/// The user's own face on the instrument — a restrained round portrait with
/// a hairline glass rim, never a social avatar. With no photo it shows the
/// user's initial (from their real account name) or a neutral figure — no
/// invented identity. Images are cached in memory and on disk (URLCache).
struct ProfileAvatar: View {
    let url: String?
    let name: String?
    var size: CGFloat = 36
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Circle().fill(StudioColor.env0.opacity(0.28))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else if let initial {
                Text(initial)
                    .font(StudioFont.hero(size * 0.42, weight: .semibold))
                    .foregroundStyle(StudioColor.paper.opacity(0.9))
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.42))
                    .foregroundStyle(StudioColor.paper.opacity(0.7))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            Circle().strokeBorder(
                LinearGradient(colors: [StudioColor.paper.opacity(0.55), StudioColor.paper.opacity(0.12)], startPoint: .top, endPoint: .bottom),
                lineWidth: 1
            )
        }
        .shadow(color: StudioColor.env0.opacity(0.22), radius: 6, y: 3)
        .task(id: url) { image = await ProfileImageCache.shared.image(for: url) }
        .accessibilityLabel(name.map { "Profile photo, \($0)" } ?? "Profile photo")
    }

    private var initial: String? {
        name?.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() }
    }
}

/// Small image cache for profile photos: memory first, then the URL cache
/// (disk), then the network. Photos are ~512 px JPEGs (see ProfilePhotoUpload).
@MainActor
final class ProfileImageCache {
    static let shared = ProfileImageCache()
    private let memory = NSCache<NSString, UIImage>()
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 2_000_000, diskCapacity: 20_000_000)
        config.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: config)
    }()

    func image(for url: String?) async -> UIImage? {
        guard let url, let u = URL(string: url) else { return nil }
        if let hit = memory.object(forKey: url as NSString) { return hit }
        guard let result = try? await session.data(from: u) else { return nil }
        let (data, response) = result
        guard ((response as? HTTPURLResponse)?.statusCode ?? 200) < 400, let image = UIImage(data: data) else { return nil }
        memory.setObject(image, forKey: url as NSString)
        return image
    }

    func insert(_ image: UIImage, for url: String) { memory.setObject(image, forKey: url as NSString) }
}
