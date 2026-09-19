import Foundation

/// Matches `convex/nutritionLogs.ts`'s own UTC-midnight fallback
/// (`Date.UTC(year, month, date)`) exactly, so entries logged from the
/// native app land on the same `date` key the backend's own default
/// resolves to.
enum NutritionDate {
    static var todayUTCMidnightMillis: Double {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let components = calendar.dateComponents([.year, .month, .day], from: Date())
        let midnight = calendar.date(from: components) ?? Date()
        return midnight.timeIntervalSince1970 * 1000
    }
}
