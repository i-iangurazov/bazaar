import Foundation

/// Compile the production journal directly; no StoreKit, network or customer data.
@main
struct AppleCancellationJournalChecks {
    @MainActor static func main() async throws {
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
        let firstAttempt = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let secondAttempt = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let journal = BazaarAppleCancellationJournal(fileURL: file)
        let initial = try journal.entries(for: production)
        check(initial.isEmpty, "A missing journal has no pending cancellations")

        let first = try journal.record(intentId: "intent-1", origin: production, attemptId: firstAttempt)
        let duplicate = try journal.record(intentId: "intent-1", origin: production, attemptId: firstAttempt)
        check(first == duplicate, "A repeated terminal outcome must be idempotent")
        let restarted = BazaarAppleCancellationJournal(fileURL: file)
        let recovered = try restarted.entries(for: production)
        check(recovered == [first], "Cancellation must survive process restart and a lost cancel response")
        let disk = try Data(contentsOf: file)
        let document = try JSONSerialization.jsonObject(with: disk) as! [String: Any]
        check(Set(document.keys) == ["version", "entries"], "Journal must only store a version and opaque entries")
        check(document["version"] as? Int == 2, "Attempt-bound journal schema must be versioned")
        let storedEntries = document["entries"] as! [[String: Any]]
        check(storedEntries.count == 1 && Set(storedEntries[0].keys) == ["intentId", "origin", "attemptId"], "Persist only opaque intent/attempt IDs and origin, never receipts, sessions or user/organization identifiers")
        check((storedEntries[0]["attemptId"] as? String).flatMap(UUID.init(uuidString:)) == firstAttempt, "Persist the actual native authorization attempt")
        check(storedEntries[0]["origin"] as? String == "https://www.bazaar.kg", "Persist only the canonical trusted origin")
        let fileAttributes = try manager.attributesOfItem(atPath: file.path)
        let directory = file.deletingLastPathComponent()
        let directoryAttributes = try manager.attributesOfItem(atPath: directory.path)
        check((fileAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Journal file must be private to its owner")
        check((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o700, "Journal directory must be private to its owner")
        let directoryValues = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        let fileValues = try file.resourceValues(forKeys: [.isExcludedFromBackupKey])
        check(directoryValues.isExcludedFromBackup == true && fileValues.isExcludedFromBackup == true, "Recovery journal must be excluded from backup")

        let previewEntry = try journal.record(intentId: "intent-1", origin: preview, attemptId: firstAttempt)
        let second = try restarted.record(intentId: "intent-2", origin: production, attemptId: secondAttempt)
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
                _ = try journal.record(intentId: invalidIntent, origin: production, attemptId: firstAttempt)
            }
        }
        let afterInvalid = try Data(contentsOf: file)
        check(beforeInvalid == afterInvalid, "Invalid input must not rewrite the journal")

        let invalidFile = root.appendingPathComponent("invalid.json")
        let invalidJournal = BazaarAppleCancellationJournal(fileURL: invalidFile)
        let corruptDocuments: [(String, BazaarAppleCancellationJournal.Failure)] = [
            ("not-json", .invalidContents),
            ("{\"version\":3,\"entries\":[]}", .unsupportedVersion),
            ("{\"version\":2,\"entries\":[{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg\",\"attemptId\":\"not-a-uuid\"}]}", .invalidContents),
            ("{\"version\":1,\"entries\":[{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg/path\"}]}", .invalidContents),
            ("{\"version\":1,\"entries\":[{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg\"},{\"intentId\":\"intent-1\",\"origin\":\"https://www.bazaar.kg\"}]}", .invalidContents),
        ]
        for (raw, failure) in corruptDocuments {
            let contents = response(raw)
            try contents.write(to: invalidFile)
            expectFailure(failure, "Corrupt or unknown journals must fail closed and preserve evidence") {
                _ = try invalidJournal.record(intentId: "intent-new", origin: production, attemptId: firstAttempt)
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
            _ = try inaccessible.record(intentId: "intent-unwritten", origin: production, attemptId: firstAttempt)
        }

        let attempts = BazaarAppleCancellationJournal(fileURL: root.appendingPathComponent("attempts.json"))
        let attemptA = try attempts.record(intentId: "same-intent", origin: production, attemptId: firstAttempt)
        let attemptB = try attempts.record(intentId: "same-intent", origin: production, attemptId: secondAttempt)
        let bothAttempts = try attempts.entries(for: production)
        check(bothAttempts == [attemptA, attemptB], "Attempts for one intent must not overwrite each other's proofs")
        let refused = try attempts.applyServerAcknowledgement(response("{\"error\":\"applePurchaseAttemptMismatch\"}"), for: attemptA)
        let retainedAttempts = try attempts.entries(for: production)
        check(refused == .unresolved && retainedAttempts == bothAttempts, "A different winning attempt is not a cancellation ACK")
        _ = try attempts.applyServerAcknowledgement(response("{\"canceled\":true,\"recorded\":false}"), for: attemptA)
        let remainingAttempt = try attempts.entries(for: production)
        check(remainingAttempt == [attemptB], "ACK removal must match the attempt as well as intent and origin")

        let legacyFile = root.appendingPathComponent("legacy.json")
        try response("{\"version\":1,\"entries\":[{\"intentId\":\"legacy-intent\",\"origin\":\"https://www.bazaar.kg\"}]}").write(to: legacyFile)
        let legacyJournal = BazaarAppleCancellationJournal(fileURL: legacyFile)
        let legacyEntries = try legacyJournal.entries(for: production)
        check(legacyEntries.count == 1 && legacyEntries[0].attemptId == nil, "Legacy proof must be preserved without inventing a winning attempt")
        _ = try legacyJournal.record(intentId: "new-intent", origin: production, attemptId: firstAttempt)
        let migrated = try JSONSerialization.jsonObject(with: Data(contentsOf: legacyFile)) as! [String: Any]
        let migratedEntries = try legacyJournal.entries(for: production)
        check(migrated["version"] as? Int == 2 && migratedEntries.contains(legacyEntries[0]), "Version migration preserves legacy evidence alongside new attempt-bound proof")

        enum AttemptFailure: Error, Equatable { case backgrounded, sdkUnknown, persistence }
        let phaseFile = root.appendingPathComponent("phase-proof.json")
        let phaseJournal = BazaarAppleCancellationJournal(fileURL: phaseFile)
        var events: [String] = []
        let lostResponse: String = try await BazaarApplePreSheetAttempt.perform(
            authorize: { () async throws -> String in events.append("authorize"); throw URLError(.timedOut) },
            prepare: { authorization in events.append("prepare"); return authorization },
            invoke: { _ in events.append("invoke"); return "purchased" },
            abort: { error in
                check((error as? URLError)?.code == .timedOut, "Preserve the original pre-sheet reason")
                events.append("abort")
                _ = try phaseJournal.record(intentId: "lost-auth-response", origin: production, attemptId: firstAttempt)
                return "not_started"
            }
        )
        check(lostResponse == "not_started" && events == ["authorize", "abort"], "A lost final auth response must never invoke StoreKit or claim OS cancellation")
        let restartedPhase = try BazaarAppleCancellationJournal(fileURL: phaseFile).entries(for: production)
        check(restartedPhase.first?.attemptId == firstAttempt, "Caught pre-sheet proof survives a lost cancel ACK and process restart")

        events = []
        let background: String = try await BazaarApplePreSheetAttempt.perform(
            authorize: { events.append("authorize"); return "authorization" },
            prepare: { (_: String) throws -> String in events.append("foreground"); throw AttemptFailure.backgrounded },
            invoke: { _ in events.append("invoke"); return "purchased" },
            abort: { error in
                check(error as? AttemptFailure == .backgrounded, "Keep the post-auth foreground failure distinct")
                events.append("abort")
                _ = try phaseJournal.record(intentId: "background-after-auth", origin: production, attemptId: secondAttempt)
                return "not_started"
            }
        )
        check(background == "not_started" && events == ["authorize", "foreground", "abort"], "Backgrounding after auth is caught before any SDK invocation")

        let sdkFailures: [Error] = [URLError(.networkConnectionLost), AttemptFailure.sdkUnknown]
        for failure in sdkFailures {
            events = []
            do {
                let _: String = try await BazaarApplePreSheetAttempt.perform(
                    authorize: { events.append("authorize"); return "authorization" },
                    prepare: { authorization in events.append("prepare"); return authorization },
                    invoke: { _ in events.append("invoke"); throw failure },
                    abort: { _ in events.append("forbidden-abort"); return "not_started" }
                )
                preconditionFailure("An unknown SDK error must remain an error")
            } catch {
                check(events == ["authorize", "prepare", "invoke"], "After invoking StoreKit, no ambiguous error may create a pre-sheet cancellation")
            }
        }
        events = []
        let pending: String = try await BazaarApplePreSheetAttempt.perform(
            authorize: { events.append("authorize"); return "authorization" },
            prepare: { authorization in events.append("prepare"); return authorization },
            invoke: { _ in events.append("invoke"); return "pending" },
            abort: { _ in events.append("forbidden-abort"); return "not_started" }
        )
        check(pending == "pending" && events == ["authorize", "prepare", "invoke"], "A pending SDK result stays pending with no cancellation proof")
        do {
            let _: String = try await BazaarApplePreSheetAttempt.perform(
                authorize: { () async throws -> String in throw URLError(.cancelled) },
                prepare: { (authorization: String) -> String in authorization },
                invoke: { (_: String) async throws -> String in throw AttemptFailure.sdkUnknown },
                abort: { (_: Error) async throws -> String in throw AttemptFailure.persistence }
            )
            preconditionFailure("A journal failure cannot resolve not_started")
        } catch {
            check(error as? AttemptFailure == .persistence, "Journal persistence errors propagate without falsely acknowledging cancellation")
        }
        print("Apple cancellation journal: \(checks) checks passed")
    }
}
