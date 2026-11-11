import StoreKit
import StoreKitTest
import XCTest
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
