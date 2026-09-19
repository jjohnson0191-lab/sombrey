import Foundation
import Observation
import Combine
import ConvexMobile

/// Thin wrapper around `ConvexClientProvider.client.subscribe(to:)`,
/// reused by every screen that needs a live Convex query (Train's
/// exercise list, Nutrition's progress/entries, Progress's measurements/
/// photos). One place to get the Combine wiring right rather than
/// repeating it per screen.
@Observable
@MainActor
final class ConvexQuery<T: Decodable> {
    private(set) var value: T?
    private(set) var isLoading = true
    private(set) var errorMessage: String?

    private var cancellable: AnyCancellable?

    func subscribe(to name: String, with args: [String: ConvexEncodable?]? = nil) {
        isLoading = true
        errorMessage = nil
        cancellable = ConvexClientProvider.client
            .subscribe(to: name, with: args, yielding: T.self)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    if case .failure(let error) = completion {
                        self?.errorMessage = String(describing: error)
                        self?.isLoading = false
                    }
                },
                receiveValue: { [weak self] newValue in
                    self?.value = newValue
                    self?.isLoading = false
                    self?.errorMessage = nil
                }
            )
    }

    func stop() {
        cancellable = nil
    }
}
