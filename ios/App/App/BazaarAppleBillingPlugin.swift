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

private struct AppleCompletionRetrySummary: Sendable {
    var pendingCount = 0
    var acknowledgedCount = 0
    var deferredCount = 0
    var recordedCount = 0
    var data: [String: Any] { ["pendingCount": pendingCount, "acknowledgedCount": acknowledgedCount, "deferredCount": deferredCount, "recordedCount": recordedCount] }
}
private enum AppleCompletionOutcome: Equatable {
    case canceled, recorded, inaccessible, unresolved
    case deferred(scheduled: Bool, effectiveAt: String)
}

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
    let productType: String?
    let appAccountToken: UUID
    let expiresAt: String
    let environment: String
    let attemptId: UUID?
    let priceConstraint: BazaarApplePriceConstraint?
    let action: String?
    let subscriptionGroupId: String?
    let deferredSource: BazaarAppleDeferredSource?
    let authorizedAt: String?
    let completionKeyFingerprint: String?

    func isValid(for intentId: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
        return self.intentId == intentId && !productId.isEmpty && productId.utf8.count <= 255 &&
            (date.map { $0 > Date() } ?? false) && (priceConstraint?.isValid ?? true)
    }
}

@objc(BazaarAppleBillingPlugin)
public final class BazaarAppleBillingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BazaarAppleBillingPlugin"
    public let jsName = "BazaarAppleBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStorefront", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retryCancellations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retryCompletions", returnType: CAPPluginReturnPromise),
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
    @MainActor private static var completionRetryTasks: [String: Task<AppleCompletionRetrySummary, Error>] = [:]
    private let completionKeys = BazaarAppleCompletionKeychain()

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
            let before = await Storefront.current
            let products = try await Product.products(for: requested)
            let after = await Storefront.current
            let storefrontId = before?.id == after?.id ? after?.id : nil
            let returned = Set(products.map(\.id))
            return [
                "products": try products.sorted { $0.id < $1.id }.map { try self.productData($0, storefrontId: storefrontId) },
                "missingProductIds": requested.filter { !returned.contains($0) },
            ]
        }
    }

    @objc public func getStorefront(_ call: CAPPluginCall) {
        run(call) {
            guard let storefront = await Storefront.current else {
                throw AppleBillingFailure(code: "APPLE_STOREFRONT_UNAVAILABLE")
            }
            return ["id": storefront.id, "countryCode": storefront.countryCode]
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        run(call) {
            guard let intentId = call.getString("intentId"), !intentId.isEmpty, intentId.utf8.count <= 80,
                  intentId.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else {
                throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT")
            }
            let purchaseOrigin = try self.trustedOrigin()
            try self.beginStoreSheet()
            defer { self.showingStoreSheet = false }
            guard AppStore.canMakePayments else { throw AppleBillingFailure(code: "APPLE_PAYMENTS_NOT_ALLOWED") }

            // Only a live server-authorized intent may select a purchasable SKU
            // and account token. Neither value is accepted from JavaScript.
            let authorization = try await self.authorize(intentId, prepareOnly: true)
            guard let product = try await Product.products(for: [authorization.productId]).first else {
                throw AppleBillingFailure(code: "APPLE_PRODUCT_UNAVAILABLE")
            }
            if let expectedType = authorization.productType, try self.productType(product.type) != expectedType {
                throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
            }
            if let expectedGroup = authorization.subscriptionGroupId, product.subscription?.subscriptionGroupID != expectedGroup {
                throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
            }
            try await self.requireSubscriptionAccountOwnership(product, token: authorization.appAccountToken)
            let attemptId = UUID()
            // The private key is durably device-only BEFORE final HTTP can bind
            // this attempt. It is never a purchase/session/grant capability.
            let credential = try self.completionKeys.create()
            return try await BazaarApplePreSheetAttempt.perform(
                authorize: {
                    // Check actual StoreKit metadata before consuming the one-use
                    // authorization. No constraint is taken from JavaScript.
                    _ = try await self.productMatchingPrice(product, constraint: authorization.priceConstraint, expectedType: authorization.productType)
                    return try await self.authorize(intentId, attemptId: attemptId, completionCredential: credential)
                },
                prepare: { current in
                    guard current.productId == authorization.productId,
                          current.appAccountToken == authorization.appAccountToken,
                          current.productType == authorization.productType,
                          current.priceConstraint == authorization.priceConstraint,
                          current.action == authorization.action,
                          current.subscriptionGroupId == authorization.subscriptionGroupId,
                          current.deferredSource == authorization.deferredSource else {
                        throw AppleBillingFailure(code: "APPLE_AUTHORIZATION_CHANGED")
                    }
                    let purchaseProduct = try await self.productMatchingPrice(product, constraint: current.priceConstraint, expectedType: current.productType)
                    if let expectedType = current.productType, try self.productType(purchaseProduct.type) != expectedType {
                        throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
                    }
                    if let expectedGroup = current.subscriptionGroupId, purchaseProduct.subscription?.subscriptionGroupID != expectedGroup {
                        throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
                    }
                    // Auth HTTP may finish after backgrounding or navigation.
                    // Keep the original origin for a caught no-SDK abort proof.
                    guard try self.trustedOrigin() == purchaseOrigin else {
                        throw AppleBillingFailure(code: "APPLE_UNTRUSTED_ORIGIN")
                    }
                    let scene = try self.foregroundScene()
                    var options: Set<Product.PurchaseOption> = [.appAccountToken(current.appAccountToken)]
                    if let constraint = current.priceConstraint {
                        let authorizedStorefront = constraint.storefrontId
                        options.insert(.onStorefrontChange { $0.id == authorizedStorefront })
                    }
                    return (purchaseProduct, scene, options, current)
                },
                invoke: { prepared in
                    // No await or fallible preflight separates this boundary
                    // from the SDK call. Every unknown error from here is paid-
                    // outcome recovery, never a caught pre-sheet cancellation.
                    let (purchaseProduct, scene, options, current) = prepared
                    let result: Product.PurchaseResult
                    do {
                        if #available(iOS 17.0, *) {
                            result = try await purchaseProduct.purchase(confirmIn: scene, options: options)
                        } else {
                            result = try await purchaseProduct.purchase(options: options)
                        }
                    } catch StoreKitError.userCancelled {
                        return try await self.terminalCancellation(intentId, origin: purchaseOrigin, attemptId: attemptId, credential: credential)
                    }
                    switch result {
                    case .success(let verification):
                        guard case .verified(let transaction) = verification else {
                            throw AppleBillingFailure(code: "APPLE_UNVERIFIED_TRANSACTION")
                        }
                        guard self.permitsTransaction(transaction, signed: verification.jwsRepresentation) else {
                            throw AppleBillingFailure(code: "APPLE_ENVIRONMENT_MISMATCH")
                        }
                        if purchaseProduct.type == .autoRenewable, current.action == "CHANGE", transaction.productID != current.productId {
                            // Capture an actually returned verified old transaction
                            // synchronously before querying any asynchronous status.
                            let entry = try self.earnedDeferred(intentId, attemptId: attemptId, origin: purchaseOrigin,
                                credential: credential, authorization: current, transaction: transaction, signed: verification.jwsRepresentation)
                            let outcome = try await self.acknowledgeCompletion(entry, captureImmediately: true)
                            return self.deferredResult(outcome)
                        }
                        return ["status": "purchased", "transaction": self.transactionData(transaction, signed: verification.jwsRepresentation)]
                    case .pending:
                        return ["status": "pending"]
                    case .userCancelled:
                        return try await self.terminalCancellation(intentId, origin: purchaseOrigin, attemptId: attemptId, credential: credential)
                    @unknown default:
                        throw AppleBillingFailure(code: "APPLE_UNKNOWN_PURCHASE_RESULT")
                    }
                },
                abort: { error in
                    try await self.preSheetAbort(intentId, origin: purchaseOrigin, attemptId: attemptId, credential: credential, error: error)
                }
            )
        }
    }

    /// Safe even after logout/departure. This retries existing earned proofs only;
    /// it cannot construct a result, reopen StoreKit or obtain account access.
    @objc public func retryCompletions(_ call: CAPPluginCall) {
        run(call) {
            let origin = try self.trustedOrigin().url.absoluteString
            if let task = Self.completionRetryTasks[origin] { return try await task.value.data }
            let task = Task { @MainActor in try await self.retryCompletionJournal() }
            Self.completionRetryTasks[origin] = task
            defer { Self.completionRetryTasks[origin] = nil }
            return try await task.value.data
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
            } catch is BazaarAppleCompletionJournal.Failure {
                call.reject("APPLE_COMPLETION_STORAGE_FAILED", "APPLE_COMPLETION_STORAGE_FAILED")
            } catch is BazaarAppleCompletionKeychain.Failure {
                call.reject("APPLE_COMPLETION_KEY_UNAVAILABLE", "APPLE_COMPLETION_KEY_UNAVAILABLE")
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

    @MainActor private func productMatchingPrice(_ original: Product, constraint: BazaarApplePriceConstraint?, expectedType: String?) async throws -> Product {
        guard let constraint else { return original }
        guard BazaarApplePricePolicy.permitsProductType(expected: expectedType, actual: try productType(original.type)) else {
            throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
        }
        let before = await Storefront.current
        guard let product = try await Product.products(for: [original.id]).first else {
            throw AppleBillingFailure(code: "APPLE_PRODUCT_UNAVAILABLE")
        }
        guard BazaarApplePricePolicy.permitsProductType(expected: expectedType, actual: try productType(product.type)) else {
            throw AppleBillingFailure(code: "APPLE_PRODUCT_UNSUPPORTED")
        }
        let after = await Storefront.current
        guard let before, let after else { throw AppleBillingFailure(code: "APPLE_STOREFRONT_UNAVAILABLE") }
        guard before.id == after.id, after.id == constraint.storefrontId else {
            throw AppleBillingFailure(code: "APPLE_STOREFRONT_CHANGED")
        }
        guard BazaarApplePricePolicy.permits(constraint, storefrontId: after.id,
            currency: product.priceFormatStyle.currencyCode, price: product.price) else {
            throw AppleBillingFailure(code: "APPLE_PRICE_CHANGED")
        }
        return product
    }

    private func transactionId(_ call: CAPPluginCall) throws -> UInt64 {
        guard let raw = call.getString("transactionId"), !raw.isEmpty, raw.utf8.count <= 20,
              raw.allSatisfy({ $0.isASCII && $0.isNumber }), let id = UInt64(raw), id > 0 else {
            throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT")
        }
        return id
    }

    @MainActor private func authorize(_ intentId: String, prepareOnly: Bool = false, attemptId: UUID? = nil,
        completionCredential: BazaarAppleCompletionCredential? = nil
    ) async throws -> ApplePurchaseAuthorization {
        var body: [String: Any] = ["intentId": intentId]
        if prepareOnly { body["prepareOnly"] = true }
        else {
            guard let attemptId, let completionCredential, completionCredential.isValid else { throw AppleBillingFailure(code: "APPLE_INVALID_ARGUMENT") }
            body["attemptId"] = attemptId.uuidString.lowercased()
            body["completionPublicKey"] = completionCredential.publicKey
        }
        let data = try await post(path: "/api/billing/apple/native/authorize", body: body)
        guard let authorization = try? JSONDecoder().decode(ApplePurchaseAuthorization.self, from: data),
              authorization.isValid(for: intentId),
              prepareOnly || (authorization.attemptId == attemptId && authorization.completionKeyFingerprint == completionCredential?.fingerprint &&
                authorization.authorizedAt.flatMap(BazaarAppleCompletionPolicy.date) != nil) else {
            throw AppleBillingFailure(code: "APPLE_AUTHORIZATION_INVALID")
        }
        guard BazaarNativeBuildChannel.compiled.permitsTransactionEnvironment(authorization.environment) else {
            throw AppleBillingFailure(code: "APPLE_ENVIRONMENT_MISMATCH")
        }
        return authorization
    }

    @MainActor private func terminalCancellation(_ intentId: String, origin: BazaarBillingOrigin, attemptId: UUID,
        credential: BazaarAppleCompletionCredential
    ) async throws -> [String: Any] {
        let journal = try BazaarAppleCompletionJournal()
        // Persist BEFORE any promise resolves. A lost cancel response or app
        // termination cannot turn this definite OS outcome into an endless hold.
        let entry = try journal.record(intentId: intentId, attemptId: attemptId, origin: origin, credential: credential, outcome: .canceled)
        let outcome = try await acknowledgeCompletion(entry)
        return [
            "status": "cancelled",
            "cancellationAcknowledged": outcome == .canceled,
            "cancellationRecorded": outcome == .recorded,
        ]
    }

    @MainActor private func preSheetAbort(_ intentId: String, origin: BazaarBillingOrigin, attemptId: UUID,
        credential: BazaarAppleCompletionCredential, error: Error
    ) async throws -> [String: Any] {
        let journal = try BazaarAppleCompletionJournal()
        // Called only by the caught pre-SDK boundary. A different device's
        // winning attempt cannot be cancelled with this UUID on the server.
        let entry = try journal.record(intentId: intentId, attemptId: attemptId, origin: origin, credential: credential, outcome: .notStarted)
        let outcome = try await acknowledgeCompletion(entry)
        let failure = (error as? AppleBillingFailure) ?? AppleBillingFailure(
            code: error is URLError ? "APPLE_NETWORK_ERROR" : "APPLE_STORE_ERROR"
        )
        var detail: [String: Any] = ["code": failure.code]
        if let serverCode = failure.serverCode { detail["serverCode"] = serverCode }
        return [
            "status": "not_started", "error": detail,
            "cancellationAcknowledged": outcome == .canceled,
            "cancellationRecorded": outcome == .recorded,
        ]
    }

    @MainActor private func earnedDeferred(_ intentId: String, attemptId: UUID, origin: BazaarBillingOrigin,
        credential: BazaarAppleCompletionCredential, authorization: ApplePurchaseAuthorization,
        transaction: StoreKit.Transaction, signed: String
    ) throws -> BazaarAppleCompletionJournal.Entry {
        guard authorization.action == "CHANGE", authorization.productType == "AUTO_RENEWABLE",
              let source = authorization.deferredSource, let group = authorization.subscriptionGroupId,
              let authorizedAt = authorization.authorizedAt,
              BazaarAppleCompletionPolicy.environment(ofVerifiedJWS: signed) == authorization.environment else {
            throw AppleBillingFailure(code: "APPLE_DEFERRED_OUTCOME_UNRESOLVED")
        }
        let context = BazaarAppleDeferredContext(productId: authorization.productId, subscriptionGroupId: group,
            appAccountToken: authorization.appAccountToken, environment: authorization.environment, authorizedAt: authorizedAt,
            source: source, signedTransactionInfo: signed, signedRenewalInfo: nil)
        guard matchesDeferredSource(context, transaction: transaction) else {
            throw AppleBillingFailure(code: "APPLE_DEFERRED_OUTCOME_UNRESOLVED")
        }
        // This method is called only directly after .success(.verified(old)).
        // No await, history lookup, timeout or cold-start inference precedes it.
        return try BazaarAppleCompletionJournal().record(intentId: intentId, attemptId: attemptId, origin: origin,
            credential: credential, outcome: .deferred, deferred: context)
    }

    private func matchesDeferredSource(_ context: BazaarAppleDeferredContext, transaction: StoreKit.Transaction) -> Bool {
        BazaarAppleCompletionPolicy.matchesSource(context, transactionId: String(transaction.id), originalTransactionId: String(transaction.originalID),
            productId: transaction.productID, groupId: transaction.subscriptionGroupID, token: transaction.appAccountToken,
            expiresAt: transaction.expirationDate, purchaseDate: transaction.purchaseDate, revoked: transaction.revocationDate != nil,
            upgraded: transaction.isUpgraded, purchasedOwnership: transaction.ownershipType == .purchased)
    }

    @MainActor private func attachVerifiedRenewal(to entry: BazaarAppleCompletionJournal.Entry,
        journal: BazaarAppleCompletionJournal
    ) async throws -> BazaarAppleCompletionJournal.Entry {
        guard let context = entry.deferred, context.signedRenewalInfo == nil else { return entry }
        let statuses = try await Product.SubscriptionInfo.status(for: context.subscriptionGroupId)
        for status in statuses {
            guard case .verified(let transaction) = status.transaction, case .verified(let renewal) = status.renewalInfo,
                  matchesDeferredSource(context, transaction: transaction),
                  BazaarAppleCompletionPolicy.environment(ofVerifiedJWS: status.transaction.jwsRepresentation) == context.environment,
                  BazaarAppleCompletionPolicy.environment(ofVerifiedJWS: status.renewalInfo.jwsRepresentation) == context.environment,
                  BazaarAppleCompletionPolicy.matchesRenewal(context, originalTransactionId: String(renewal.originalTransactionID),
                    currentProductId: renewal.currentProductID, nextProductId: renewal.autoRenewPreference, token: renewal.appAccountToken,
                    willAutoRenew: renewal.willAutoRenew, renewalDate: renewal.renewalDate, signedDate: renewal.signedDate) else { continue }
            return try journal.attachRenewal(status.renewalInfo.jwsRepresentation, to: entry)
        }
        return entry
    }

    private func deferredResult(_ outcome: AppleCompletionOutcome) -> [String: Any] {
        var data: [String: Any] = ["status": "deferred", "completionAcknowledged": false, "completionRecorded": false, "scheduled": false]
        switch outcome {
        case .deferred(let scheduled, let effectiveAt):
            data["completionAcknowledged"] = true; data["scheduled"] = scheduled; data["effectiveAt"] = effectiveAt
        case .recorded:
            data["completionAcknowledged"] = true; data["completionRecorded"] = true
        default: break
        }
        return data
    }

    @MainActor private func retryCompletionJournal() async throws -> AppleCompletionRetrySummary {
        let origin = try trustedOrigin(), journal = try BazaarAppleCompletionJournal()
        let entries = try journal.entries(for: origin)
        var summary = AppleCompletionRetrySummary(), inaccessible = Set<String>()
        for entry in entries {
            switch try await acknowledgeCompletion(entry) {
            case .canceled: summary.acknowledgedCount += 1
            case .deferred: summary.deferredCount += 1
            case .recorded: summary.recordedCount += 1
            case .inaccessible: inaccessible.insert(entry.sameInvocationKey)
            case .unresolved: break
            }
        }
        summary.pendingCount = try journal.entries(for: origin).filter { !inaccessible.contains($0.sameInvocationKey) }.count
        return summary
    }

    @MainActor private func acknowledgeCompletion(_ original: BazaarAppleCompletionJournal.Entry, captureImmediately: Bool = false) async throws -> AppleCompletionOutcome {
        guard original.origin == (try trustedOrigin()).url.absoluteString else { return .inaccessible }
        let journal = try BazaarAppleCompletionJournal()
        var entry = original
        if captureImmediately && entry.outcome == .deferred && entry.deferred?.signedRenewalInfo == nil {
            do { entry = try await attachVerifiedRenewal(to: entry, journal: journal) }
            catch is BazaarAppleCompletionJournal.Failure { throw BazaarAppleCompletionJournal.Failure.unavailable }
            catch { /* Capture may be retried only for this already-earned result. */ }
        }
        if entry.outcome == .deferred {
            // Probe before any status/JWS work on retries: known money must not
            // be trapped behind an unavailable or superseded old Apple proof.
            let money = try await submitCompletion(entry, journal: journal, recordedOnly: true)
            if money == .recorded || money == .inaccessible { return money }
        }
        if entry.outcome == .deferred, entry.deferred?.signedRenewalInfo == nil {
            do { entry = try await attachVerifiedRenewal(to: entry, journal: journal) }
            catch is BazaarAppleCompletionJournal.Failure { throw BazaarAppleCompletionJournal.Failure.unavailable }
            catch { /* The already-earned SDK result survives a status/network failure. */ }
            if entry.deferred?.signedRenewalInfo == nil { return .unresolved }
        }
        return try await submitCompletion(entry, journal: journal)
    }

    @MainActor private func submitCompletion(_ entry: BazaarAppleCompletionJournal.Entry,
        journal: BazaarAppleCompletionJournal, recordedOnly: Bool = false
    ) async throws -> AppleCompletionOutcome {
        do {
            var body: [String: Any] = ["intentId": entry.intentId, "attemptId": entry.attemptId.uuidString.lowercased(),
                "keyFingerprint": entry.credential.fingerprint, "outcome": recordedOnly ? "RECORDED_ONLY" : entry.outcome.rawValue]
            if entry.outcome == .deferred && !recordedOnly {
                guard let proof = entry.deferred, let renewal = proof.signedRenewalInfo else { return .unresolved }
                body["transactionDigest"] = BazaarAppleCompletionCrypto.digest(proof.signedTransactionInfo)
                body["renewalDigest"] = BazaarAppleCompletionCrypto.digest(renewal)
            }
            let data = try await post(path: "/api/billing/apple/native/completion/challenge", body: body, withSession: false)
            struct Challenge: Decodable { let challenge: String; let expiresAt: String }
            guard let challenge = try? JSONDecoder().decode(Challenge.self, from: data),
                  BazaarAppleCompletionChallenge.permits(challenge.challenge, expiresAt: challenge.expiresAt, entry: entry, recordedOnly: recordedOnly) else {
                return .unresolved
            }
            let signature = try completionKeys.sign(challenge.challenge, with: entry.credential)
            var submission: [String: Any] = ["challenge": challenge.challenge, "signature": signature]
            if entry.outcome == .deferred && !recordedOnly {
                submission["signedTransactionInfo"] = entry.deferred?.signedTransactionInfo
                submission["signedRenewalInfo"] = entry.deferred?.signedRenewalInfo
            }
            let response = try await post(path: "/api/billing/apple/native/completion", body: submission, withSession: false)
            switch try journal.applyAcknowledgement(response, to: entry) {
            case .canceled:
                try? completionKeys.remove(entry.credential); return .canceled
            case .deferred(let scheduled, let effectiveAt):
                try? completionKeys.remove(entry.credential); return .deferred(scheduled: scheduled, effectiveAt: effectiveAt)
            case .recorded:
                try? completionKeys.remove(entry.credential); return .recorded
            case .unresolved: return .unresolved
            }
        } catch let error as AppleBillingFailure {
            if error.httpStatus == 403 || error.httpStatus == 404 ||
                (error.httpStatus == 409 && ["appleCompletionUnavailable", "applePurchaseAttemptMismatch"].contains(error.serverCode ?? "")) { return .inaccessible }
            if error.code == "APPLE_UNTRUSTED_ORIGIN" { throw error }
            return .unresolved
        } catch is BazaarAppleCompletionKeychain.Failure { return .unresolved }
        catch is URLError { return .unresolved }
    }

    @MainActor private func retryCancellationJournal() async throws -> AppleCancellationRetrySummary {
        let origin = try trustedOrigin()
        let journal = try BazaarAppleCancellationJournal()
        let entries = try journal.entries(for: origin)
        var summary = AppleCancellationRetrySummary()
        var inaccessible = Set<BazaarAppleCancellationJournal.Entry>()
        for entry in entries {
            switch try await acknowledgeCancellation(entry, journal: journal) {
            case .acknowledged: summary.acknowledgedCount += 1
            case .recorded: summary.recordedCount += 1
            case .inaccessible: inaccessible.insert(entry)
            case .noSession:
                // Preserve every entry. Without an authenticated actor we cannot
                // label any remaining intent as pending for the current org.
                summary.pendingCount = 0
                return summary
            case .unresolved: break
            }
        }
        summary.pendingCount = try journal.entries(for: origin).filter { !inaccessible.contains($0) }.count
        return summary
    }

    @MainActor private func acknowledgeCancellation(
        _ entry: BazaarAppleCancellationJournal.Entry, journal: BazaarAppleCancellationJournal
    ) async throws -> AppleCancellationOutcome {
        guard entry.origin == (try trustedOrigin()).url.absoluteString else { return .inaccessible }
        let data: Data
        do {
            var body: [String: Any] = ["intentId": entry.intentId]
            if let attemptId = entry.attemptId { body["attemptId"] = attemptId.uuidString.lowercased() }
            data = try await post(path: "/api/billing/apple/native/cancel", body: body)
        } catch let error as AppleBillingFailure {
            if error.code == "APPLE_SESSION_REQUIRED" || error.httpStatus == 401 { return .noSession }
            if error.code == "APPLE_FORBIDDEN" || error.httpStatus == 403 || error.httpStatus == 404 { return .inaccessible }
            if error.httpStatus == 409 && error.serverCode == "applePurchaseAttemptMismatch" { return .inaccessible }
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

    @MainActor private func post(path: String, body: [String: Any], withSession: Bool = true) async throws -> Data {
        let origin = try trustedOrigin()
        var cookieHeader: String?
        if withSession {
            guard let store = webView?.configuration.websiteDataStore.httpCookieStore else { throw AppleBillingFailure(code: "APPLE_SESSION_REQUIRED") }
            let allCookies = await withCheckedContinuation { continuation in store.getAllCookies { continuation.resume(returning: $0) } }
            // Do not hide an impersonation session by forwarding only auth cookies.
            guard !origin.hasImpersonationSession(allCookies) else { throw AppleBillingFailure(code: "APPLE_FORBIDDEN", serverCode: "forbidden") }
            let cookies = origin.sessionCookies(allCookies)
            guard !cookies.isEmpty else { throw AppleBillingFailure(code: "APPLE_SESSION_REQUIRED") }
            cookieHeader = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"]
        } else {
            guard ["/api/billing/apple/native/completion/challenge", "/api/billing/apple/native/completion"].contains(path) else {
                throw AppleBillingFailure(code: "APPLE_FORBIDDEN")
            }
        }
        let url = origin.url.appendingPathComponent(String(path.dropFirst()))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(origin.url.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("kg.bazaar.app", forHTTPHeaderField: "X-Bazaar-Native-App")
        if let cookieHeader { request.setValue(cookieHeader, forHTTPHeaderField: "Cookie") }
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

    private func productData(_ product: Product, storefrontId: String?) throws -> [String: Any] {
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
        if let millis = BazaarApplePricePolicy.priceMillis(product.price) { data["priceMillis"] = millis }
        if let storefrontId { data["storefrontId"] = storefrontId }
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
