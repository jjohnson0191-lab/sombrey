import Foundation

/// A row from the real, existing `measurements` table
/// (`convex/measurements.ts`'s `list` query). All fields optional to
/// match the schema exactly — a measurement entry may log only weight,
/// only circumferences, etc.
struct MeasurementEntry: Decodable, Identifiable {
    let id: String
    let date: Double
    let weight: Double?
    let bodyFat: Double?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case date, weight, bodyFat
    }
}

/// A row from the real, existing `progressPhotos` table
/// (`convex/progressPhotos.ts`'s `list` query). Only the count/date are
/// used in Phase 2 — the capture/upload flow is a later phase.
struct ProgressPhotoEntry: Decodable, Identifiable {
    let id: String
    let date: Double

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case date
    }
}
