import StoreKit
import StoreKitTest
import XCTest
import CryptoKit
import Security
import UIKit
@testable import App

@MainActor
final class BazaarAppleBillingTests: XCTestCase {
    private enum Refusal: Error { case notRecorded }
    private let consumable = "kg.bazaar.testing.consumable"
    private let permanent = "kg.bazaar.testing.permanent"

    private func session() throws -> SKTestSession {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "BazaarNativeTests", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        return session
    }

    private func unfinishedIds() async -> Set<UInt64> {
        var ids = Set<UInt64>()
        for await result in StoreKit.Transaction.unfinished {
            switch result {
            case .verified(let transaction), .unverified(let transaction, _): ids.insert(transaction.id)
            }
        }
        return ids
    }

    func testServerRefusalKeepsPurchaseForDurableRecovery() async throws {
        let session = try session()
        defer { session.clearTransactions(); session.resetToDefaultState() }
        let token = UUID()
        let transaction = try await session.buyProduct(identifier: consumable, options: [.appAccountToken(token)])
        XCTAssertEqual(transaction.appAccountToken, token)
        let before = await unfinishedIds()
        XCTAssertTrue(before.contains(transaction.id))

        var acknowledgementCalls = 0
        do {
            try await BazaarAppleTransactionFinisher.finish(transactionId: transaction.id) { actual, signed in
                acknowledgementCalls += 1
                XCTAssertEqual(actual.id, transaction.id)
                XCTAssertEqual(actual.appAccountToken, token)
                XCTAssertEqual(signed.split(separator: ".").count, 3)
                throw Refusal.notRecorded
            }
            XCTFail("A refused transaction must not finish")
        } catch Refusal.notRecorded { }
        XCTAssertEqual(acknowledgementCalls, 1)
        let afterRefusal = await unfinishedIds()
        XCTAssertEqual(afterRefusal, before)

        // A new read uses StoreKit's queue, with no JS or in-memory success flag.
        try await BazaarAppleTransactionFinisher.finish(transactionId: transaction.id) { actual, signed in
            acknowledgementCalls += 1
            XCTAssertEqual(actual.id, transaction.id)
            XCTAssertFalse(signed.isEmpty)
        }
        XCTAssertEqual(acknowledgementCalls, 2)
        let afterAcknowledgement = await unfinishedIds()
        XCTAssertFalse(afterAcknowledgement.contains(transaction.id))
    }

    func testFinishingOneRecordPreservesOtherPurchases() async throws {
        let session = try session()
        defer { session.clearTransactions(); session.resetToDefaultState() }
        let first = try await session.buyProduct(identifier: consumable)
        let second = try await session.buyProduct(identifier: consumable)
        XCTAssertNotEqual(first.id, second.id)
        try await BazaarAppleTransactionFinisher.finish(transactionId: first.id) { actual, _ in
            XCTAssertEqual(actual.id, first.id)
        }
        let remaining = await unfinishedIds()
        XCTAssertFalse(remaining.contains(first.id))
        XCTAssertTrue(remaining.contains(second.id))
    }

    func testRepeatedFinishStillRequiresServerAcknowledgement() async throws {
        let session = try session()
        defer { session.clearTransactions(); session.resetToDefaultState() }
        let transaction = try await session.buyProduct(identifier: permanent)
        try await BazaarAppleTransactionFinisher.finish(transactionId: transaction.id) { _, _ in }
        var calls = 0
        do {
            try await BazaarAppleTransactionFinisher.finish(transactionId: transaction.id) { actual, _ in
                XCTAssertEqual(actual.id, transaction.id)
                calls += 1
                throw Refusal.notRecorded
            }
            XCTFail("A retry still needs the server's durable record")
        } catch Refusal.notRecorded { }
        XCTAssertEqual(calls, 1)
        try await BazaarAppleTransactionFinisher.finish(transactionId: transaction.id) { _, _ in calls += 1 }
        XCTAssertEqual(calls, 2)
    }

    func testUnknownTransactionCannotAcknowledgeOrFinish() async throws {
        let session = try session()
        defer { session.clearTransactions(); session.resetToDefaultState() }
        var calls = 0
        do {
            try await BazaarAppleTransactionFinisher.finish(transactionId: UInt64.max) { _, _ in calls += 1 }
            XCTFail("Unknown transactions must fail closed")
        } catch BazaarAppleTransactionFinisher.Failure.transactionNotFound { }
        XCTAssertEqual(calls, 0)
    }

    func testUnverifiedTransactionIsNeverAcknowledgedOrFinished() async throws {
        let session = try session()
        defer { session.clearTransactions(); session.resetToDefaultState() }
        let transaction = try await session.buyProduct(identifier: consumable)
        try await session.setSimulatedError(.verification(.invalidSignature), forAPI: .verification)
        var calls = 0
        do {
            try await BazaarAppleTransactionFinisher.finish(transactionId: transaction.id) { _, _ in calls += 1 }
            XCTFail("Unverified transactions must fail closed")
        } catch BazaarAppleTransactionFinisher.Failure.transactionNotFound { }
        XCTAssertEqual(calls, 0)
        let remaining = await unfinishedIds()
        XCTAssertTrue(remaining.contains(transaction.id))
    }
}

/// Real iOS Simulator Keychain integration, separate from SKTestSession cases.
/// Every query is scoped to a UUID returned by create() in the same test. Only
/// those exact keys are removed; this class never enumerates/deletes a service.
@MainActor
final class BazaarAppleCompletionKeychainTests: XCTestCase {
    private let service = "kg.bazaar.app.apple-native-completion.v1"

    private func requireIsolatedSimulatorHost() throws {
        #if targetEnvironment(simulator)
        XCTAssertEqual(ProcessInfo.processInfo.environment["BAZAAR_NATIVE_STOREKIT_TESTS"], "1")
        guard ProcessInfo.processInfo.environment["BAZAAR_NATIVE_STOREKIT_TESTS"] == "1",
              BazaarNativeBuildChannel.compiled == .development,
              Bundle.main.bundleIdentifier == "kg.bazaar.app" else {
            throw NSError(domain: "BazaarKeychainTests", code: 1)
        }
        let root = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController)
        guard type(of: root) == UIViewController.self else {
            XCTFail("The DEBUG test host must remain a local blank controller")
            throw NSError(domain: "BazaarKeychainTests", code: 2)
        }
        #else
        throw XCTSkip("This integration test may only use the owned iOS Simulator Keychain")
        #endif
    }

    private func attributes(for credential: BazaarAppleCompletionCredential) -> (OSStatus, [String: Any]?) {
        // The account is always a just-created, test-owned UUID; no wildcard.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credential.keyTag,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result as? [String: Any])
    }

    private func expectFailure(_ expected: BazaarAppleCompletionKeychain.Failure,
        file: StaticString = #filePath, line: UInt = #line, _ operation: () throws -> String
    ) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            guard let failure = error as? BazaarAppleCompletionKeychain.Failure else {
                XCTFail("Unexpected Keychain failure type", file: file, line: line); return
            }
            switch (expected, failure) {
            case (.unavailable, .unavailable), (.invalidKey, .invalidKey): break
            default: XCTFail("Unexpected Keychain failure classification", file: file, line: line)
            }
        }
    }

    func testRealKeychainSurvivesFreshInstanceAndSignsP1363() async throws {
        try requireIsolatedSimulatorHost()
        let credential = try BazaarAppleCompletionKeychain().create()
        defer { XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(credential)) }
        XCTAssertTrue(credential.isValid)
        XCTAssertNotNil(UUID(uuidString: credential.keyTag))
        XCTAssertEqual(credential.keyTag, credential.keyTag.lowercased())
        let challenge = "QA-only opaque completion challenge / fresh native instance"
        let encoded = try BazaarAppleCompletionKeychain().sign(challenge, with: credential)
        let raw = try XCTUnwrap(Data(base64Encoded: encoded))
        XCTAssertEqual(raw.count, 64)
        XCTAssertEqual(raw.base64EncodedString(), encoded)
        let publicKey = try P256.Signing.PublicKey(derRepresentation: XCTUnwrap(Data(base64Encoded: credential.publicKey)))
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: raw)
        XCTAssertTrue(publicKey.isValidSignature(signature, for: Data(challenge.utf8)))
        XCTAssertFalse(publicKey.isValidSignature(signature, for: Data((challenge + "tampered").utf8)))
        let (status, _) = attributes(for: credential)
        XCTAssertEqual(status, errSecSuccess)
    }

    func testStoredItemIsDeviceOnlyAfterFirstUnlockAndNeverSynchronizes() async throws {
        try requireIsolatedSimulatorHost()
        let credential = try BazaarAppleCompletionKeychain().create()
        defer { XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(credential)) }
        let (status, stored) = attributes(for: credential)
        XCTAssertEqual(status, errSecSuccess)
        let storedAttributes = try XCTUnwrap(stored)
        XCTAssertEqual(storedAttributes[kSecAttrAccount as String] as? String, credential.keyTag)
        XCTAssertEqual(storedAttributes[kSecAttrService as String] as? String, service)
        XCTAssertEqual(storedAttributes[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertEqual(storedAttributes[kSecAttrSynchronizable as String] as? Bool, false)
        XCTAssertNil(storedAttributes[kSecValueData as String], "The metadata query must not expose private bytes")
    }

    func testTamperedEnrollmentCannotUseStoredPrivateKey() async throws {
        try requireIsolatedSimulatorHost()
        let credential = try BazaarAppleCompletionKeychain().create()
        defer { XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(credential)) }
        let impostor = BazaarAppleCompletionCrypto.credential(for: P256.Signing.PrivateKey(), tag: credential.keyTag)
        XCTAssertTrue(impostor.isValid)
        expectFailure(.unavailable) { try BazaarAppleCompletionKeychain().sign("challenge", with: impostor) }
        let invalid = BazaarAppleCompletionCredential(keyTag: credential.keyTag, publicKey: credential.publicKey,
            fingerprint: String(repeating: "0", count: 64))
        expectFailure(.invalidKey) { try BazaarAppleCompletionKeychain().sign("challenge", with: invalid) }
        XCTAssertNoThrow(try BazaarAppleCompletionKeychain().sign("original enrollment remains usable", with: credential))
        XCTAssertEqual(attributes(for: credential).0, errSecSuccess)
    }

    func testExactRemovalIsIdempotentAndMissingKeyCannotSign() async throws {
        try requireIsolatedSimulatorHost()
        let credential = try BazaarAppleCompletionKeychain().create()
        defer { XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(credential)) }
        XCTAssertEqual(attributes(for: credential).0, errSecSuccess)
        try BazaarAppleCompletionKeychain().remove(credential)
        XCTAssertEqual(attributes(for: credential).0, errSecItemNotFound)
        expectFailure(.unavailable) { try BazaarAppleCompletionKeychain().sign("no private key remains", with: credential) }
        XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(credential))
        XCTAssertEqual(attributes(for: credential).0, errSecItemNotFound)
    }

    func testRemovingOneAttemptPreservesTheOtherKeyAndSignatureBinding() async throws {
        try requireIsolatedSimulatorHost()
        let first = try BazaarAppleCompletionKeychain().create()
        defer { XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(first)) }
        let second = try BazaarAppleCompletionKeychain().create()
        defer { XCTAssertNoThrow(try BazaarAppleCompletionKeychain().remove(second)) }
        XCTAssertNotEqual(first.keyTag, second.keyTag)
        XCTAssertNotEqual(first.fingerprint, second.fingerprint)
        let challenge = Data("two isolated completion attempts".utf8)
        let firstPublic = try P256.Signing.PublicKey(derRepresentation: XCTUnwrap(Data(base64Encoded: first.publicKey)))
        let secondPublic = try P256.Signing.PublicKey(derRepresentation: XCTUnwrap(Data(base64Encoded: second.publicKey)))
        let firstSignature = try P256.Signing.ECDSASignature(rawRepresentation: XCTUnwrap(Data(base64Encoded:
            BazaarAppleCompletionKeychain().sign(String(decoding: challenge, as: UTF8.self), with: first))))
        XCTAssertTrue(firstPublic.isValidSignature(firstSignature, for: challenge))
        XCTAssertFalse(secondPublic.isValidSignature(firstSignature, for: challenge))
        try BazaarAppleCompletionKeychain().remove(first)
        XCTAssertEqual(attributes(for: first).0, errSecItemNotFound)
        XCTAssertEqual(attributes(for: second).0, errSecSuccess)
        expectFailure(.unavailable) { try BazaarAppleCompletionKeychain().sign("removed attempt", with: first) }
        let secondSignature = try P256.Signing.ECDSASignature(rawRepresentation: XCTUnwrap(Data(base64Encoded:
            BazaarAppleCompletionKeychain().sign(String(decoding: challenge, as: UTF8.self), with: second))))
        XCTAssertTrue(secondPublic.isValidSignature(secondSignature, for: challenge))
        XCTAssertFalse(firstPublic.isValidSignature(secondSignature, for: challenge))
    }
}

/// One-case fixture diagnostic. It never changes production signing or entitlements.
/// Attachments contain only OSStatus and its system explanation, never item data.
@MainActor
final class BazaarAppleCompletionKeychainFixtureDiagnostics: XCTestCase {
    private let service = "kg.bazaar.app.apple-native-completion.v1"

    private func requireIsolatedSimulatorHost() throws {
        #if targetEnvironment(simulator)
        XCTAssertEqual(ProcessInfo.processInfo.environment["BAZAAR_NATIVE_STOREKIT_TESTS"], "1")
        guard ProcessInfo.processInfo.environment["BAZAAR_NATIVE_STOREKIT_TESTS"] == "1",
              BazaarNativeBuildChannel.compiled == .development,
              Bundle.main.bundleIdentifier == "kg.bazaar.app" else {
            throw NSError(domain: "BazaarKeychainFixtureDiagnostic", code: 1)
        }
        let root = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController)
        guard type(of: root) == UIViewController.self else {
            XCTFail("The DEBUG test host must remain a local blank controller")
            throw NSError(domain: "BazaarKeychainFixtureDiagnostic", code: 2)
        }
        #else
        throw XCTSkip("This diagnostic may only use the owned iOS Simulator Keychain")
        #endif
    }

    private func record(_ status: OSStatus, name: String) {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? ""
        let attachment = XCTAttachment(string: "\(status)\n\(message)")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func removeSuccessfulOwnedItem(_ account: String) -> OSStatus {
        // Only called after this case successfully added this exact UUID.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
        return SecItemDelete(query as CFDictionary)
    }

    func testRawSecItemAddReportsProductionAndMinimalControlStatus() async throws {
        try requireIsolatedSimulatorHost()
        let productionAccount = UUID().uuidString.lowercased()
        let controlAccount = UUID().uuidString.lowercased()
        guard productionAccount != controlAccount else {
            XCTFail("Fresh diagnostic UUIDs must be distinct"); return
        }
        let productionShaped: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: productionAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: Data(repeating: 0x5a, count: 32),
        ]
        let productionStatus = SecItemAdd(productionShaped as CFDictionary, nil)
        defer {
            if productionStatus == errSecSuccess {
                XCTAssertEqual(removeSuccessfulOwnedItem(productionAccount), errSecSuccess)
            }
        }
        let minimalControl: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: controlAccount,
            kSecValueData as String: Data("QA-only Keychain fixture control".utf8),
        ]
        let controlStatus = SecItemAdd(minimalControl as CFDictionary, nil)
        defer {
            if controlStatus == errSecSuccess {
                XCTAssertEqual(removeSuccessfulOwnedItem(controlAccount), errSecSuccess)
            }
        }
        record(productionStatus, name: "Production-shaped SecItemAdd OSStatus")
        record(controlStatus, name: "Minimal-control SecItemAdd OSStatus")
        // This diagnostic is a failure if either fixture cannot store an item.
        // Merely capturing an explanatory error must never become a passing test.
        XCTAssertEqual(productionStatus, errSecSuccess, "Production-shaped SecItemAdd must succeed")
        XCTAssertEqual(controlStatus, errSecSuccess, "Minimal-control SecItemAdd must succeed")
    }
}
