import Foundation

/// Compile the production journal directly; no StoreKit, network or customer data.
@main
struct AppleCancellationJournalChecks {
    static func main() throws {
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            precondition(condition(), message)
            checks += 1
        }
        func expectFailure(_ expected: BazaarAppleCancellationJournal.Failure, _ message: String, operation: () throws -> Void) {
            do {
                try operation()
                preconditionFailure(message)
            } catch {
                check((error as? BazaarAppleCancellationJournal.Failure) == expected, message)
            }
        }
        func response(_ raw: String) -> Data { Data(raw.utf8) }
        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent("bazaar-cancel-journal-check-" + UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let file = root.appendingPathComponent("recovery/cancelled-intents.json")
        let production = BazaarBillingOrigin(configuredURL: URL(string: "https://www.bazaar.kg:443/billing")!, developmentBuild: false)!
        let preview = BazaarBillingOrigin(configuredURL: URL(string: "https://preview.example.invalid")!, developmentBuild: true)!
        let journal = BazaarAppleCancellationJournal(fileURL: file)
        let initial = try journal.entries(for: production)
        check(initial.isEmpty, "A missing journal has no pending cancellations")

        let first = try journal.record(intentId: "intent-1", origin: production)
        let duplicate = try journal.record(intentId: "intent-1", origin: production)
        check(first == duplicate, "A repeated terminal outcome must be idempotent")
        let restarted = BazaarAppleCancellationJournal(fileURL: file)
        let recovered = try restarted.entries(for: production)
        check(recovered == [first], "Cancellation must survive process restart and a lost cancel response")
        let disk = try Data(contentsOf: file)
        let document = try JSONSerialization.jsonObject(with: disk) as! [String: Any]
        check(Set(document.keys) == ["version", "entries"], "Journal must only store a version and opaque entries")
        check(document["version"] as? Int == 1, "Journal schema must be versioned")
        let storedEntries = document["entries"] as! [[String: Any]]
        check(storedEntries.count == 1 && Set(storedEntries[0].keys) == ["intentId", "origin"], "Never persist receipts, sessions, account tokens or user/organization identifiers")
        check(storedEntries[0]["origin"] as? String == "https://www.bazaar.kg", "Persist only the canonical trusted origin")
        let fileAttributes = try manager.attributesOfItem(atPath: file.path)
        let directory = file.deletingLastPathComponent()
        let directoryAttributes = try manager.attributesOfItem(atPath: directory.path)
        check((fileAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Journal file must be private to its owner")
        check((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o700, "Journal directory must be private to its owner")
        let directoryValues = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        let fileValues = try file.resourceValues(forKeys: [.isExcludedFromBackupKey])
        check(directoryValues.isExcludedFromBackup == true && fileValues.isExcludedFromBackup == true, "Recovery journal must be excluded from backup")

        let previewEntry = try journal.record(intentId: "intent-1", origin: preview)
        let second = try restarted.record(intentId: "intent-2", origin: production)
        let ownBeforeAck = try journal.entries(for: production)
        let previewBeforeAck = try journal.entries(for: preview)
        check(ownBeforeAck == [first, second] && previewBeforeAck == [previewEntry], "Origin scoping must preserve unrelated entries")
        for invalidResponse in [
            "{}", "not-json", "{\"canceled\":false,\"recorded\":false}",
            "{\"canceled\":true}", "{\"canceled\":1,\"recorded\":false}",
            "{\"canceled\":\"true\",\"recorded\":false}",
        ] {
            let result = try journal.applyServerAcknowledgement(response(invalidResponse), for: first)
            let entries = try journal.entries(for: production)
            check(result == .unresolved && entries.contains(first), "Malformed or unresolved server responses must retain the cancellation")
        }
        let canceled = try journal.applyServerAcknowledgement(response("{\"canceled\":true,\"recorded\":false}"), for: first)
        let ownAfterAck = try restarted.entries(for: production)
        let previewAfterAck = try restarted.entries(for: preview)
        check(canceled == .canceled, "Only explicit durable cancellation may acknowledge cancellation")
        check(ownAfterAck == [second] && previewAfterAck == [previewEntry], "An ACK must reread the journal and preserve records added by another instance")
        let repeatedAck = try journal.applyServerAcknowledgement(response("{\"canceled\":true,\"recorded\":false}"), for: first)
        check(repeatedAck == .canceled, "Replayed scoped server acknowledgement is idempotent")
        let recorded = try journal.applyServerAcknowledgement(response("{\"canceled\":true,\"recorded\":true}"), for: second)
        let finalOwn = try restarted.entries(for: production)
        let finalPreview = try restarted.entries(for: preview)
        check(recorded == .recorded && finalOwn.isEmpty, "Recorded money takes precedence and must never be reported as a cancellation")
        check(finalPreview == [previewEntry], "Other origins survive all current-origin acknowledgements")

        let beforeInvalid = try Data(contentsOf: file)
        for invalidIntent in ["", String(repeating: "a", count: 81), "signed.receipt.payload", "path/id", "id\nsecret", "идентификатор"] {
            expectFailure(.invalidEntry, "Reject anything other than a bounded opaque intent identifier") {
                _ = try journal.record(intentId: invalidIntent, origin: production)
            }
        }
        let afterInvalid = try Data(contentsOf: file)
        check(beforeInvalid == afterInvalid, "Invalid input must not rewrite the journal")

        let invalidFile = root.appendingPathComponent("invalid.json")
        let invalidJournal = BazaarAppleCancellationJournal(fileURL: invalidFile)
        let corruptDocuments: [(String, BazaarAppleCancellationJournal.Failure)] = [
            ("not-json", .invalidContents),
            ("{\"version\":2,\"entries\":[]}", .unsupportedVersion),
            ("{\"version\":1,\"entries\":[{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg/path\"}]}", .invalidContents),
            ("{\"version\":1,\"entries\":[{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg\"},{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg\"}]}", .invalidContents),
        ]
        for (raw, failure) in corruptDocuments {
            let contents = response(raw)
            try contents.write(to: invalidFile)
            expectFailure(failure, "Corrupt or unknown journals must fail closed and preserve evidence") {
                _ = try invalidJournal.record(intentId: "intent-new", origin: production)
            }
            let unchanged = try Data(contentsOf: invalidFile)
            check(unchanged == contents, "Never replace an unreadable journal with an empty journal")
        }
        try response("not-json").write(to: invalidFile)
        expectFailure(.invalidContents, "Acknowledgement must not silently discard a corrupt journal") {
            _ = try invalidJournal.applyServerAcknowledgement(response("{\"canceled\":true,\"recorded\":false}"), for: first)
        }
        try Data(repeating: 0, count: 1_048_577).write(to: invalidFile)
        expectFailure(.tooLarge, "Journal reads must be bounded") { _ = try invalidJournal.entries(for: production) }

        let blocked = root.appendingPathComponent("not-a-directory")
        try Data().write(to: blocked)
        let inaccessible = BazaarAppleCancellationJournal(fileURL: blocked.appendingPathComponent("cancelled.json"))
        expectFailure(.storageUnavailable, "A persistence failure must not masquerade as a durable cancellation") {
            _ = try inaccessible.record(intentId: "intent-unwritten", origin: production)
        }
        print("Apple cancellation journal: \(checks) checks passed")
    }
}
