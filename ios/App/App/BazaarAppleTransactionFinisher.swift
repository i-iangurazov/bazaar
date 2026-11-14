import StoreKit

/// StoreKit owns the durable pending queue; the server owns fulfillment.
@MainActor
enum BazaarAppleTransactionFinisher {
    enum Failure: Error { case transactionNotFound }

    static func finish(
        transactionId: UInt64,
        acknowledge: (StoreKit.Transaction, String) async throws -> Void
    ) async throws {
        for await result in StoreKit.Transaction.unfinished {
            guard case .verified(let transaction) = result, transaction.id == transactionId else { continue }
            try await acknowledge(transaction, result.jwsRepresentation)
            await transaction.finish()
            return
        }
        // An idempotent retry must still belong to a recorded transaction. No
        // caller-supplied receipt or success flag can replace the server check.
        let result = try await find(transactionId)
        try await acknowledge(result.transaction, result.signed)
    }

    static func find(_ transactionId: UInt64) async throws -> (transaction: StoreKit.Transaction, signed: String) {
        for await result in StoreKit.Transaction.all {
            guard case .verified(let transaction) = result, transaction.id == transactionId else { continue }
            return (transaction, result.jwsRepresentation)
        }
        throw Failure.transactionNotFound
    }
}
