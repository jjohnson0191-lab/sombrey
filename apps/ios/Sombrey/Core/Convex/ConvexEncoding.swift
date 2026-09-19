import Foundation
import ConvexMobile

/// `convex-swift` ships `ConvexEncodable` conformance for scalars and for
/// the specific existential type `[ConvexEncodable?]`, but not for a
/// plain `[MyStruct]` array argument (e.g. AI Coach's `messages`). This
/// conditional conformance — any array of `Encodable` elements — covers
/// that gap the same way the library's own scalar/dictionary extensions
/// do (JSON-encode the value), without needing every call site to box
/// its arrays into `[ConvexEncodable?]` by hand.
extension Array: ConvexEncodable where Element: Encodable {
    public func convexEncode() throws -> String {
        String(decoding: try JSONEncoder().encode(self), as: UTF8.self)
    }
}
