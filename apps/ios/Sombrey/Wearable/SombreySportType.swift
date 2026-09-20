// GENERATED from the vendor's real OdmSportPlusExerciseModelType enum
// (apps/ios/Frameworks/QCBandSDK.framework/Headers/OdmSportPlusModels.h).
// Regenerate by re-running the header parser if QCBandSDK is ever upgraded —
// do not hand-edit raw values or add entries not present in the real header.
import Foundation

/// One entry in the full Sport+ catalog — the scalable mapping layer the
/// Phase 3 training-architecture spec calls for, instead of 150 bespoke
/// screens. `rawValue` matches `OdmSportPlusExerciseModelType` exactly.
struct SombreySportType: Identifiable, Hashable, Sendable {
    let rawValue: Int
    let displayName: String
    let category: String
    /// True for the handful of types whose name/vendor comment implies the
    /// SDK expects the app to supply GPS via CoreLocation during the session
    /// (the band has no onboard GPS chip — see the Phase 3 wearable audit).
    let usesPhoneGPS: Bool

    var id: Int { rawValue }
}

extension SombreySportType {
    static let all: [SombreySportType] = [
        SombreySportType(rawValue: 1, displayName: "GPS Run", category: "Running & Walking", usesPhoneGPS: true),
        SombreySportType(rawValue: 2, displayName: "GPS Bike", category: "Running & Walking", usesPhoneGPS: true),
        SombreySportType(rawValue: 3, displayName: "GPS Walk", category: "Running & Walking", usesPhoneGPS: true),
        SombreySportType(rawValue: 4, displayName: "Walk", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 5, displayName: "Rope Skipping", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 6, displayName: "Swimming", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 7, displayName: "Run", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 8, displayName: "Hiking", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 9, displayName: "Bike", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 10, displayName: "Other Exercise", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 11, displayName: "Swing", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 20, displayName: "Climb", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 21, displayName: "Badminton", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 22, displayName: "Yoga", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 23, displayName: "Aerobics", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 24, displayName: "Spinning Bike", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 25, displayName: "Kayaking", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 26, displayName: "Elliptical Machine", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 27, displayName: "Rowing Machine", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 28, displayName: "Pingpong", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 29, displayName: "Tennis", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 30, displayName: "Golf", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 31, displayName: "Basketball", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 32, displayName: "Football", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 33, displayName: "Volleyball", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 34, displayName: "Rock Climbing", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 35, displayName: "Dance", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 36, displayName: "Roller Skating", category: "Ball, Racket & Studio", usesPhoneGPS: false),
        SombreySportType(rawValue: 40, displayName: "Treadmill", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 41, displayName: "Indoor Walking", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 42, displayName: "Trail Running", category: "Running & Walking", usesPhoneGPS: true),
        SombreySportType(rawValue: 43, displayName: "Race Walk", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 44, displayName: "Playground Running", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 45, displayName: "Fat Loss Running", category: "Running & Walking", usesPhoneGPS: false),
        SombreySportType(rawValue: 50, displayName: "Outdoor Cycling", category: "Cycling", usesPhoneGPS: true),
        SombreySportType(rawValue: 51, displayName: "Indoor Cycling", category: "Cycling", usesPhoneGPS: false),
        SombreySportType(rawValue: 52, displayName: "Mountain Biking", category: "Cycling", usesPhoneGPS: true),
        SombreySportType(rawValue: 53, displayName: "B M X", category: "Cycling", usesPhoneGPS: false),
        SombreySportType(rawValue: 55, displayName: "Swimming Pool", category: "Swimming", usesPhoneGPS: false),
        SombreySportType(rawValue: 56, displayName: "Outdoor Swimming", category: "Swimming", usesPhoneGPS: true),
        SombreySportType(rawValue: 57, displayName: "Fin Swimming", category: "Swimming", usesPhoneGPS: false),
        SombreySportType(rawValue: 58, displayName: "Synchronized Swimming", category: "Swimming", usesPhoneGPS: false),
        SombreySportType(rawValue: 60, displayName: "Outdoor Hiking", category: "Outdoor & Hiking", usesPhoneGPS: true),
        SombreySportType(rawValue: 61, displayName: "Orienteering", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 62, displayName: "Fishing", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 63, displayName: "Hunt", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 64, displayName: "Skateboard", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 65, displayName: "Parkour", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 66, displayName: "A T V", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 67, displayName: "Motocross", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 68, displayName: "Racing", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 69, displayName: "Hand Crank", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 70, displayName: "Marathon", category: "Outdoor & Hiking", usesPhoneGPS: true),
        SombreySportType(rawValue: 71, displayName: "Obstacle Course", category: "Outdoor & Hiking", usesPhoneGPS: false),
        SombreySportType(rawValue: 80, displayName: "Stair Climber", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 81, displayName: "Stair Stepper", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 82, displayName: "Mixed Aerobic", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 83, displayName: "Kickboxing", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 84, displayName: "Core Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 85, displayName: "Cross Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 86, displayName: "Indoor Fitness", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 87, displayName: "Group Gymnastics", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 88, displayName: "Strength Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 89, displayName: "Gap Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 90, displayName: "Free Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 91, displayName: "Flexibility Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 92, displayName: "Gymnastics", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 93, displayName: "Stretch", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 94, displayName: "Pilates", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 95, displayName: "Horizontal Bar", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 96, displayName: "Parallel Bars", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 97, displayName: "Battle Rope", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 98, displayName: "Fitness", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 99, displayName: "Balance Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 100, displayName: "Step Training", category: "Indoor & Strength Training", usesPhoneGPS: false),
        SombreySportType(rawValue: 110, displayName: "Square Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 111, displayName: "Ballroom Dancing", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 112, displayName: "Belly Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 113, displayName: "Ballet", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 114, displayName: "Street Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 115, displayName: "Zumba", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 116, displayName: "Latin Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 117, displayName: "Latin Jazz", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 118, displayName: "Hip Hop Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 119, displayName: "Pole Dancing", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 120, displayName: "Break Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 121, displayName: "Folk Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 122, displayName: "New Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 123, displayName: "Modern Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 124, displayName: "Disco", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 125, displayName: "Tap Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 126, displayName: "Other Dance", category: "Dance", usesPhoneGPS: false),
        SombreySportType(rawValue: 130, displayName: "Boxing", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 131, displayName: "Wrestling", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 132, displayName: "Martial Arts", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 133, displayName: "Tai Chi", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 134, displayName: "Muay Thai", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 135, displayName: "Judo", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 136, displayName: "Taekwondo", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 137, displayName: "Karate", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 138, displayName: "Free Sparring", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 139, displayName: "Swordsmanship", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 140, displayName: "Jujitsu", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 141, displayName: "Fencing", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 142, displayName: "Kendo", category: "Combat Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 150, displayName: "Beach Football", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 151, displayName: "Beach Volleyball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 152, displayName: "Baseball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 153, displayName: "Softball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 154, displayName: "New Football", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 155, displayName: "Hockey", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 156, displayName: "Squash", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 157, displayName: "Door Kick", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 158, displayName: "Cricket", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 159, displayName: "Handball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 160, displayName: "Bowling", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 161, displayName: "Polo", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 162, displayName: "Racquetball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 163, displayName: "Billiards", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 164, displayName: "Takraw", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 165, displayName: "Dodge Ball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 166, displayName: "Water Polo", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 167, displayName: "Puck", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 168, displayName: "Shuttlecock", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 169, displayName: "Indoor Soccer", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 170, displayName: "Sandbag", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 171, displayName: "Bocce", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 172, displayName: "Jai Ball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 173, displayName: "Floor Ball", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 174, displayName: "Australian Rules Football", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 175, displayName: "Pickering", category: "Ball Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 180, displayName: "Outdoor Boating", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 181, displayName: "Sailing", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 182, displayName: "Dragon Boat", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 183, displayName: "Surf", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 184, displayName: "Kitesurfing", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 185, displayName: "Paddling", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 186, displayName: "Paddleboard", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 187, displayName: "Indoor Surfing", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 188, displayName: "Drifting", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 189, displayName: "Snorkeling", category: "Water Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 190, displayName: "Skis", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 191, displayName: "Snowboard", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 192, displayName: "Alpine Skiing", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 193, displayName: "Cross Country Skiing", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 194, displayName: "Ski Orientserlng", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 195, displayName: "Biathlon", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 196, displayName: "Outdoor Skating", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 197, displayName: "Indoor Skating", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 198, displayName: "Curling", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 199, displayName: "Bobsleigh", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 200, displayName: "Sled", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 201, displayName: "Snowmobile", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 202, displayName: "Snowshoeing", category: "Winter Sports", usesPhoneGPS: false),
        SombreySportType(rawValue: 210, displayName: "Hula Hoop", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 211, displayName: "Frisbee", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 212, displayName: "Darts", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 213, displayName: "Fly A Kite", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 214, displayName: "Tug Of War", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 215, displayName: "Esports", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 216, displayName: "Stroller", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 217, displayName: "New Swing", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 218, displayName: "Shuffleboard", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 219, displayName: "Table Soccer", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 220, displayName: "Somatosensory Game", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 221, displayName: "Bungee Jumping", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 222, displayName: "Parachute", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 223, displayName: "Anusara", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 224, displayName: "Yin Yoga", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 225, displayName: "Pregnancy Yoga", category: "Leisure", usesPhoneGPS: false),
        SombreySportType(rawValue: 230, displayName: "International Chess", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 231, displayName: "Go", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 232, displayName: "Checkers", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 233, displayName: "Board Game", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 234, displayName: "Bridge", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 235, displayName: "Triathlon", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 236, displayName: "Archery", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 237, displayName: "Compound Movement", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 238, displayName: "Drive", category: "Board Games & Other", usesPhoneGPS: false),
        SombreySportType(rawValue: 10086, displayName: "Other Extension", category: "Other", usesPhoneGPS: false),
    ]

    static let byRawValue: [Int: SombreySportType] = Dictionary(uniqueKeysWithValues: all.map { ($0.rawValue, $0) })

    static let categories: [String] = {
        var seen = Set<String>()
        var order: [String] = []
        for entry in all where !seen.contains(entry.category) {
            seen.insert(entry.category)
            order.append(entry.category)
        }
        return order
    }()

    /// A small, curated set surfaced first in the picker UI — the rest of
    /// the full catalog remains one search away, never hidden.
    static let featuredRawValues: [Int] = [
        1,   // GPS Run
        3,   // GPS Walk
        2,   // GPS Bike
        51,  // Indoor Cycling
        55,  // Pool Swimming
        88,  // Strength Training
        60,  // Outdoor Hiking
        22,  // Yoga
        85,  // Cross Training
    ]
}
