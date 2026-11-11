import Capacitor
import Foundation
import StoreKit
import UIKit
import WebKit

private struct AppleBillingFailure: Error {
    let code: String
    var serverCode: String? = nil
    var httpStatus: Int? = nil
}

private struct AppleCancellationRetrySummary: Sendable {
    var pendingCount = 0
    var acknowledgedCount = 0
    var recordedCount = 0

    var data: [String: Any] {
        ["pendingCount": pendingCount, "acknowledgedCount": acknowledgedCount, "recordedCount": recordedCount]
    }
}

private enum AppleCancellationOutcome: Equatable { case acknowledged, recorded, inaccessible, noSession, unresolved }

/// No redirects, shared cookie storage, or credentials can escape the compiled origin.
private final class AppleBillingHTTPDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct ApplePurchaseAuthorization: Decodable {
    let intentId: String
    let productId: String
    let appAccountToken: UUID
    let expiresAt: String
    let environment: String

    func isValid(for intentId: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
        return self.intentId == intentId && !productId.isEmpty && productId.utf8.count <= 255 &&
            (date.map { $0 > Date() } ?? false)
    }
}

@objc(BazaarAppleBillingPlugin)
public final class BazaarAppleBillingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BazaarAppleBillingPlugin"
    public let jsName = "BazaarAppleBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retryCancellations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getUnfinishedTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTransactionHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showManageSubscriptions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestRefund", returnType: CAPPluginReturnPromise),
    ]

    // These properties are confined to MainActor by each entry point below.
    private var updatesTask: Task<Void, Never>?
    private var showingStoreSheet = false
    private let httpDelegate = AppleBillingHTTPDelegate()
    @MainActor private static var cancellationRetryTasks: [String: Task<AppleCancellationRetrySummary, Error>] = [:]

    public override func load() {
        // Start immediately, including before the hosted page has loaded. StoreKit
        // keeps transactions unfinished across launches until the server ACKs them.
        updatesTask = Task { @MainActor [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard !Task.isCancelled else { break }
                guard let self, (try? self.trustedOrigin()) != nil else { continue }
                switch result {
                case .verified(let transaction):
                    guard self.permitsTransaction(transaction, signed: result.jwsRepresentation) else { continue }
                    self.notifyListeners("transactionUpdated", data: [
                        "transaction": self.transactionData(transaction, signed: result.jwsRepresentation)
                    ])
                case .unverified:
                    self.notifyListeners("transactionUpdated", data: ["error": ["code": "APPLE_UNVERIFIED_TRANSACTION"]])
                }
            }
        }
    }

    deinit { updatesTask?.cancel() }

    @objc public func getProducts(_ call: CAPPluginCall) {
        run(call) {
            guard let ids = call.getArray("productIds", String.self), !ids.isEmpty, ids.count <= 100,
                  ids.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 255 }) else {
                throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT")
            }
            let requested = Array(Set(ids)).sorted()
            let products = try await Product.products(for: requested)
            let returned = Set(products.map(\.id))
            return [
                "products": try products.sorted { $0.id < $1.id }.map(self.productData),
                "missingProductIds": requested.filter { !returned.contains($0) },
            ]
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        run(call) {
            guard let intentId = call.getString("intentId"), !intentId.isEmpty, intentId.utf8.count <= 80,
                  intentId.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else {
                throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT")
            }
            try self.beginStoreSheet()
            defer { self.showingStoreSheet = false }
            guard AppStore.canMakePayments else { throw AppleBillingFailure(code: "APPLE_PAYMENTS_NOT_ALLOWED") }

            // Only a live server-authorized intent may select a purchasable SKU
            // and account token. Neither value is accepted from JavaScript.
            let authorization = try await self.authorize(intentId, prepareOnly: true)
            guard let product = try await Product.products(for: [authorization.productId]).first else {
                throw AppleBillingFailure(code: "APPLE_PRODUCT_UNAVAILABLE")
            }
            try await self.requireSubscriptionAccountOwnership(product, token: authorization.appAccountToken)
            // Fetching StoreKit metadata can take time. Recheck provider conflicts,
            // permissions and intent expiry immediately before Apple's payment UI.
            let current = try await self.authorize(intentId)
            guard current.productId == authorization.productId,
                  current.appAccountToken == authorization.appAccountToken else {
                throw AppleBillingFailure(code: "APPLE_AUTHORIZATION_CHANGED")
            }
            let purchaseOrigin = try self.trustedOrigin()
            let scene = try self.foregroundScene()
            let options: Set<Product.PurchaseOption> = [.appAccountToken(current.appAccountToken)]
            let result: Product.PurchaseResult
            do {
                if #available(iOS 17.0, *) {
                    result = try await product.purchase(confirmIn: scene, options: options)
                } else {
                    result = try await product.purchase(options: options)
                }
            } catch StoreKitError.userCancelled {
                return try await self.terminalCancellation(intentId, origin: purchaseOrigin)
            }
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    throw AppleBillingFailure(code: "APPLE_UNVERIFIED_TRANSACTION")
                }
                guard self.permitsTransaction(transaction, signed: verification.jwsRepresentation) else {
                    throw AppleBillingFailure(code: "APPLE_ENVIRONMENT_MISMATCH")
                }
                // A signed transaction is evidence for the server, never an
                // entitlement. A mismatch or late completion must be reconciled.
                return ["status": "purchased", "transaction": self.transactionData(transaction, signed: verification.jwsRepresentation)]
            case .pending:
                return ["status": "pending"]
            case .userCancelled:
                return try await self.terminalCancellation(intentId, origin: purchaseOrigin)
            @unknown default:
                throw AppleBillingFailure(code: "APPLE_UNKNOWN_PURCHASE_RESULT")
            }
        }
    }

    @objc public func retryCancellations(_ call: CAPPluginCall) {
        run(call) {
            let origin = try self.trustedOrigin().url.absoluteString
            if let task = Self.cancellationRetryTasks[origin] { return try await task.value.data }
            let task = Task { @MainActor in try await self.retryCancellationJournal() }
            Self.cancellationRetryTasks[origin] = task
            defer { Self.cancellationRetryTasks[origin] = nil }
            return try await task.value.data
        }
    }

    @objc public func getUnfinishedTransactions(_ call: CAPPluginCall) {
        run(call) {
            var transactions: [[String: Any]] = []
            var unverified: [String] = []
            for await result in StoreKit.Transaction.unfinished {
                switch result {
                case .verified(let transaction):
                    guard self.permitsTransaction(transaction, signed: result.jwsRepresentation) else { continue }
                    transactions.append(self.transactionData(transaction, signed: result.jwsRepresentation))
                case .unverified(let transaction, _):
                    unverified.append(String(transaction.id))
                }
            }
            return ["transactions": transactions, "unverifiedTransactionIds": unverified]
        }
    }

    @objc public func getTransactionHistory(_ call: CAPPluginCall) {
        run(call) { try await self.historyPage(cursor: call.getString("cursor")) }
    }

    @objc public func restorePurchases(_ call: CAPPluginCall) {
        run(call) {
            try self.beginStoreSheet()
            defer { self.showingStoreSheet = false }
            _ = try self.foregroundScene()
            // This can ask for an Apple Account login, so it is only exposed as an
            // explicit user action. Background recovery uses unfinished instead.
            try await AppStore.sync()
            return try await self.historyPage(cursor: nil)
        }
    }

    @objc public func finishTransaction(_ call: CAPPluginCall) {
        run(call) {
            let id = try self.transactionId(call)
            // Re-read StoreKit's durable queue; no in-memory receipt or JS boolean
            // can stand in for server acknowledgement.
            try await BazaarAppleTransactionFinisher.finish(transactionId: id) { transaction, signed in
                try await self.requireAcknowledgement(transaction, signed: signed)
            }
            return ["finished": true]
        }
    }

    @objc public func showManageSubscriptions(_ call: CAPPluginCall) {
        run(call) {
            try self.beginStoreSheet()
            defer { self.showingStoreSheet = false }
            try await AppStore.showManageSubscriptions(in: self.foregroundScene())
            return [:]
        }
    }

    @objc public func requestRefund(_ call: CAPPluginCall) {
        run(call) {
            let id = try self.transactionId(call)
            try self.beginStoreSheet()
            defer { self.showingStoreSheet = false }
            let result = try await BazaarAppleTransactionFinisher.find(id)
            // The same durable-record check also enforces current organization
            // ownership before exposing that transaction's refund request sheet.
            try await self.requireAcknowledgement(result.transaction, signed: result.signed)
            switch try await result.transaction.beginRefundRequest(in: self.foregroundScene()) {
            case .success: return ["status": "submitted"]
            case .userCancelled: return ["status": "cancelled"]
            @unknown default: throw AppleBillingFailure(code: "APPLE_REFUND_FAILED")
            }
        }
    }

    private func run(_ call: CAPPluginCall, operation: @escaping @MainActor () async throws -> [String: Any]) {
        Task { @MainActor in
            do {
                _ = try self.trustedOrigin()
                let response = try await operation()
                // Never deliver signed records into another origin after navigation.
                _ = try self.trustedOrigin()
                call.resolve(response)
            } catch let error as AppleBillingFailure {
                call.reject(error.code, error.code, nil, error.serverCode.map { ["serverCode": $0] })
            } catch is BazaarAppleTransactionFinisher.Failure {
                call.reject("APPLE_TRANSACTION_NOT_FOUND", "APPLE_TRANSACTION_NOT_FOUND")
            } catch is BazaarAppleCancellationJournal.Failure {
                call.reject("APPLE_CANCELLATION_STORAGE_FAILED", "APPLE_CANCELLATION_STORAGE_FAILED")
            } catch let error as StoreKitError {
                switch error {
                case .userCancelled: call.reject("APPLE_CANCELLED", "APPLE_CANCELLED")
                case .networkError: call.reject("APPLE_NETWORK_ERROR", "APPLE_NETWORK_ERROR")
                case .notAvailableInStorefront: call.reject("APPLE_PRODUCT_UNAVAILABLE", "APPLE_PRODUCT_UNAVAILABLE")
                default: call.reject("APPLE_STORE_ERROR", "APPLE_STORE_ERROR")
                }
            } catch let error as Product.PurchaseError {
                let code = error == .purchaseNotAllowed ? "APPLE_PAYMENTS_NOT_ALLOWED" :
                    error == .productUnavailable ? "APPLE_PRODUCT_UNAVAILABLE" : "APPLE_PURCHASE_FAILED"
                call.reject(code, code)
            } catch is URLError {
                call.reject("APPLE_NETWORK_ERROR", "APPLE_NETWORK_ERROR")
            } catch {
                call.reject("APPLE_STORE_ERROR", "APPLE_STORE_ERROR")
            }
        }
    }

    @MainActor private func trustedOrigin() throws -> BazaarBillingOrigin {
        guard let configured = bridge?.config.serverURL,
              let origin = BazaarNativeBuildChannel.compiled.trustedOrigin(configuredURL: configured),
              origin.matches(webView?.url) else { throw AppleBillingFailure(code: "APPLE_UNTRUSTED_ORIGIN") }
        return origin
    }

    @MainActor private func beginStoreSheet() throws {
        guard !showingStoreSheet else { throw AppleBillingFailure(code: "APPLE_STORE_BUSY") }
        showingStoreSheet = true
    }

    @MainActor private func requireSubscriptionAccountOwnership(_ product: Product, token: UUID) async throws {
        guard product.type == .autoRenewable else { return }
        guard let groupId = product.subscription?.subscriptionGroupID, !groupId.isEmpty else {
            throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
        }
        for await result in StoreKit.Transaction.currentEntitlements {
            switch result {
            case .verified(let transaction):
                guard transaction.productType == .autoRenewable else { continue }
                guard BazaarAppleSubscriptionPolicy.permitsPurchase(
                    selectedGroupId: groupId,
                    selectedAccountToken: token,
                    entitlementGroupId: transaction.subscriptionGroupID,
                    entitlementAccountToken: transaction.appAccountToken,
                    verified: true
                ) else {
                    throw AppleBillingFailure(
                        code: "APPLE_SUBSCRIPTION_ACCOUNT_CONFLICT",
                        serverCode: "applePurchaseOrganizationMismatch"
                    )
                }
            case .unverified:
                throw AppleBillingFailure(code: "APPLE_UNVERIFIED_TRANSACTION")
            }
        }
    }

    @MainActor private func foregroundScene() throws -> UIWindowScene {
        guard let scene = bridge?.viewController?.view.window?.windowScene,
              scene.activationState == .foregroundActive else {
            throw AppleBillingFailure(code: "APPLE_APP_NOT_ACTIVE")
        }
        return scene
    }

    private func transactionId(_ call: CAPPluginCall) throws -> UInt64 {
        guard let raw = call.getString("transactionId"), !raw.isEmpty, raw.utf8.count <= 20,
              raw.allSatisfy({ $0.isASCII && $0.isNumber }), let id = UInt64(raw), id > 0 else {
            throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT")
        }
        return id
    }

    @MainActor private func authorize(_ intentId: String, prepareOnly: Bool = false) async throws -> ApplePurchaseAuthorization {
        var body: [String: Any] = ["intentId": intentId]
        if prepareOnly { body["prepareOnly"] = true }
        let data = try await post(path: "/api/billing/apple/native/authorize", body: body)
        guard let authorization = try? JSONDecoder().decode(ApplePurchaseAuthorization.self, from: data),
              authorization.isValid(for: intentId) else {
            throw AppleBillingFailure(code: "APPLE_AUTHORIZATION_INVALID")
        }
        guard BazaarNativeBuildChannel.compiled.permitsTransactionEnvironment(authorization.environment) else {
            throw AppleBillingFailure(code: "APPLE_ENVIRONMENT_MISMATCH")
        }
        return authorization
    }

    @MainActor private func terminalCancellation(_ intentId: String, origin: BazaarBillingOrigin) async throws -> [String: Any] {
        let journal = try BazaarAppleCancellationJournal()
        // Persist BEFORE any promise resolves. A lost cancel response or app
        // termination cannot turn this definite OS outcome into an endless hold.
        let entry = try journal.record(intentId: intentId, origin: origin)
        let outcome = try await acknowledgeCancellation(entry, journal: journal)
        return [
            "status": "cancelled",
            "cancellationAcknowledged": outcome == .acknowledged,
            "cancellationRecorded": outcome == .recorded,
        ]
    }

    @MainActor private func retryCancellationJournal() async throws -> AppleCancellationRetrySummary {
        let origin = try trustedOrigin()
        let journal = try BazaarAppleCancellationJournal()
        let entries = try journal.entries(for: origin)
        var summary = AppleCancellationRetrySummary()
        var inaccessible = Set<String>()
        for entry in entries {
            switch try await acknowledgeCancellation(entry, journal: journal) {
            case .acknowledged: summary.acknowledgedCount += 1
            case .recorded: summary.recordedCount += 1
            case .inaccessible: inaccessible.insert(entry.intentId)
            case .noSession:
                // Preserve every entry. Without an authenticated actor we cannot
                // label any remaining intent as pending for the current org.
                summary.pendingCount = 0
                return summary
            case .unresolved: break
            }
        }
        summary.pendingCount = try journal.entries(for: origin).filter { !inaccessible.contains($0.intentId) }.count
        return summary
    }

    @MainActor private func acknowledgeCancellation(
        _ entry: BazaarAppleCancellationJournal.Entry, journal: BazaarAppleCancellationJournal
    ) async throws -> AppleCancellationOutcome {
        guard entry.origin == (try trustedOrigin()).url.absoluteString else { return .inaccessible }
        let data: Data
        do {
            data = try await post(path: "/api/billing/apple/native/cancel", body: ["intentId": entry.intentId])
        } catch let error as AppleBillingFailure {
            if error.code == "APPLE_SESSION_REQUIRED" || error.httpStatus == 401 { return .noSession }
            if error.code == "APPLE_FORBIDDEN" || error.httpStatus == 403 || error.httpStatus == 404 { return .inaccessible }
            if error.code == "APPLE_UNTRUSTED_ORIGIN" { throw error }
            return .unresolved
        } catch is URLError {
            return .unresolved
        }
        // Recorded money must go through normal receipt/review recovery. It is
        // not a cancellation, but its durable server ACK resolves this journal.
        switch try journal.applyServerAcknowledgement(data, for: entry) {
        case .recorded: return .recorded
        case .canceled: return .acknowledged
        case .unresolved: return .unresolved
        }
    }

    @MainActor private func requireAcknowledgement(_ transaction: StoreKit.Transaction, signed: String) async throws {
        guard permitsTransaction(transaction, signed: signed) else {
            throw AppleBillingFailure(code: "APPLE_ENVIRONMENT_MISMATCH")
        }
        let data = try await post(path: "/api/billing/apple/native/acknowledge", body: [
            "transactionId": String(transaction.id), "signedTransactionInfo": signed,
        ])
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              result["finishAllowed"] as? Bool == true else {
            throw AppleBillingFailure(code: "APPLE_SERVER_NOT_ACKNOWLEDGED")
        }
    }

    @MainActor private func post(path: String, body: [String: Any]) async throws -> Data {
        let origin = try trustedOrigin()
        guard let store = webView?.configuration.websiteDataStore.httpCookieStore else {
            throw AppleBillingFailure(code: "APPLE_SESSION_REQUIRED")
        }
        let allCookies = await withCheckedContinuation { continuation in
            store.getAllCookies { continuation.resume(returning: $0) }
        }
        // Do not hide an impersonation session by forwarding only auth cookies.
        guard !origin.hasImpersonationSession(allCookies) else {
            throw AppleBillingFailure(code: "APPLE_FORBIDDEN", serverCode: "forbidden")
        }
        let cookies = origin.sessionCookies(allCookies)
        guard !cookies.isEmpty else { throw AppleBillingFailure(code: "APPLE_SESSION_REQUIRED") }
        let url = origin.url.appendingPathComponent(String(path.dropFirst()))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(origin.url.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("kg.bazaar.app", forHTTPHeaderField: "X-Bazaar-Native-App")
        request.setValue(HTTPCookie.requestHeaderFields(with: cookies)["Cookie"], forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: httpDelegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, origin.matches(response.url) else {
            throw AppleBillingFailure(code: "APPLE_SERVER_RESPONSE_INVALID")
        }
        guard (200...299).contains(response.statusCode) else {
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let serverCode = (payload?["code"] as? String) ?? (payload?["error"] as? String)
            let code = response.statusCode == 401 ? "APPLE_SESSION_REQUIRED" :
                response.statusCode == 403 ? "APPLE_FORBIDDEN" :
                response.statusCode == 409 ? "APPLE_BILLING_CONFLICT" : "APPLE_SERVER_ERROR"
            throw AppleBillingFailure(code: code, serverCode: serverCode, httpStatus: response.statusCode)
        }
        return data
    }

    private func productData(_ product: Product) throws -> [String: Any] {
        var data: [String: Any] = [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            // Decimal strings are display metadata, never authoritative charges.
            "price": NSDecimalNumber(decimal: product.price).stringValue,
            "currencyCode": product.priceFormatStyle.currencyCode,
            "type": try productType(product.type),
        ]
        if let subscription = product.subscription {
            let period = subscription.subscriptionPeriod
            let unit: String
            switch period.unit {
            case .day: unit = "day"
            case .week: unit = "week"
            case .month: unit = "month"
            case .year: unit = "year"
            @unknown default: throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
            }
            data["subscriptionPeriod"] = ["value": period.value, "unit": unit]
            data["subscriptionGroupId"] = subscription.subscriptionGroupID
        }
        return data
    }

    private func productType(_ type: Product.ProductType) throws -> String {
        switch type {
        case .consumable: return "CONSUMABLE"
        case .nonConsumable: return "NON_CONSUMABLE"
        case .nonRenewable: return "NON_RENEWING"
        case .autoRenewable: return "AUTO_RENEWABLE"
        default: throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
        }
    }

    private func transactionData(_ transaction: StoreKit.Transaction, signed: String) -> [String: Any] {
        var data: [String: Any] = [
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID,
            "signedTransactionInfo": signed,
            "purchaseDate": ISO8601DateFormatter().string(from: transaction.purchaseDate),
            "ownershipType": transaction.ownershipType.rawValue,
            "isUpgraded": transaction.isUpgraded,
        ]
        if #available(iOS 16.0, *) { data["environment"] = transaction.environment.rawValue }
        if let token = transaction.appAccountToken { data["appAccountToken"] = token.uuidString.lowercased() }
        if let expiry = transaction.expirationDate { data["expirationDate"] = ISO8601DateFormatter().string(from: expiry) }
        if let revoked = transaction.revocationDate { data["revocationDate"] = ISO8601DateFormatter().string(from: revoked) }
        return data
    }

    private func permitsTransaction(_ transaction: StoreKit.Transaction, signed: String) -> Bool {
        if BazaarNativeBuildChannel.compiled != .stagingTestFlight { return true }
        let environment: String?
        if #available(iOS 16.0, *) {
            environment = transaction.environment == .sandbox ? "Sandbox" : transaction.environment.rawValue
        } else { environment = nil }
        return BazaarNativeBuildChannel.compiled.permitsVerifiedTransaction(platformEnvironment: environment, signed: signed)
    }

    private struct HistoryPosition {
        let milliseconds: Int64
        let id: UInt64
        init(_ transaction: StoreKit.Transaction) {
            milliseconds = Int64(transaction.purchaseDate.timeIntervalSince1970 * 1000)
            id = transaction.id
        }
        init?(cursor: String) {
            let parts = cursor.split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count == 2, let date = Int64(parts[0]), date >= 0, let id = UInt64(parts[1]), id > 0 else { return nil }
            self.milliseconds = date
            self.id = id
        }
        var cursor: String { "\(milliseconds):\(id)" }
        func precedes(_ other: HistoryPosition) -> Bool {
            milliseconds < other.milliseconds || (milliseconds == other.milliseconds && id < other.id)
        }
    }

    private func historyPage(cursor: String?) async throws -> [String: Any] {
        let before = cursor.flatMap(HistoryPosition.init(cursor:))
        if cursor != nil && before == nil { throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT") }
        let pageSize = 50
        var page: [(transaction: StoreKit.Transaction, signed: String)] = []
        var unverified: [String] = []
        // Date + ID cursors remain stable when a renewal arrives during paging.
        // Keeping just the newest page + 1 avoids an unbounded native JS payload.
        for await result in StoreKit.Transaction.all {
            switch result {
            case .verified(let transaction):
                guard permitsTransaction(transaction, signed: result.jwsRepresentation) else { continue }
                if let before, !HistoryPosition(transaction).precedes(before) { continue }
                page.append((transaction, result.jwsRepresentation))
                page.sort { HistoryPosition($1.transaction).precedes(HistoryPosition($0.transaction)) }
                if page.count > pageSize + 1 { page.removeLast() }
            case .unverified(let transaction, _):
                unverified.append(String(transaction.id))
            }
        }
        let hasMore = page.count > pageSize
        if hasMore { page.removeLast() }
        var data: [String: Any] = [
            "transactions": page.map { transactionData($0.transaction, signed: $0.signed) },
            "unverifiedTransactionIds": unverified,
            "nextCursor": NSNull(),
        ]
        if hasMore, let last = page.last { data["nextCursor"] = HistoryPosition(last.transaction).cursor }
        return data
    }
}
