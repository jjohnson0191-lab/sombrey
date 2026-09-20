import Foundation
// @preconcurrency: CLLocation/CLLocationManager predate Swift concurrency
// auditing, same rationale as QCBandSDKService's CoreBluetooth import.
@preconcurrency import CoreLocation

struct GPSPoint {
    let latitude: Double
    let longitude: Double
    let recordedAt: Date
    let altitudeMeters: Double?
}

/// Phone-GPS tracking for Sport+ session types that need it — the
/// Sombrey Band has no onboard GPS chip (confirmed against the vendor
/// SDK's headers: `OdmGeneralExerciseDetailModel.gpsLocations` is a plain
/// `[CLLocation]` the app supplies, not something the band provides).
/// Used only for `SombreySportType.usesPhoneGPS` sessions — never runs
/// otherwise, and stops the moment a session ends.
@MainActor
final class GPSTracker: NSObject {
    private let locationManager = CLLocationManager()
    private(set) var route: [GPSPoint] = []
    private var isTracking = false

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.activityType = .fitness
    }

    var authorizationStatus: CLAuthorizationStatus {
        locationManager.authorizationStatus
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    func requestAuthorizationIfNeeded() {
        guard authorizationStatus == .notDetermined else { return }
        locationManager.requestWhenInUseAuthorization()
    }

    func startTracking() {
        route.removeAll()
        isTracking = true
        locationManager.startUpdatingLocation()
    }

    func stopTracking() {
        isTracking = false
        locationManager.stopUpdatingLocation()
    }
}

extension GPSTracker: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            guard self.isTracking, let location = locations.last else { return }
            self.route.append(GPSPoint(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                recordedAt: location.timestamp,
                altitudeMeters: location.verticalAccuracy >= 0 ? location.altitude : nil
            ))
        }
    }
}
