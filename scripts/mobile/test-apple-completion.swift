import CryptoKit
import Foundation

/// Production crypto/policy/journal checks. No Keychain reads/writes, StoreKit,
/// accounts, network, server or provider operations are performed.
@main
struct AppleCompletionChecks {
    static func main() throws {
        var checks = 0
        func check(_ value: @autoclosure () throws -> Bool, _ message: String) {
            do { let result = try value(); precondition(result, message); checks += 1 }
            catch { preconditionFailure(message) }
        }
        func mustFail(_ message: String, _ operation: () throws -> Void) {
            do { try operation(); preconditionFailure(message) } catch { checks += 1 }
        }
        func hex(_ value: String) -> Data {
            Data(stride(from: 0, to: value.count, by: 2).map { index in
                let start = value.index(value.startIndex, offsetBy: index), end = value.index(start, offsetBy: 2)
                return UInt8(value[start..<end], radix: 16)!
            })
        }
        func jws(_ label: String) -> String {
            let body = Data("{\"environment\":\"Sandbox\",\"fixture\":\"\(label)\"}".utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            return "syntheticHeader." + body + ".syntheticSignatureOnly"
        }
        let key = try P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 0, count: 31) + Data([1]))
        let tag = "11111111-1111-4111-8111-111111111111"
        let credential = BazaarAppleCompletionCrypto.credential(for: key, tag: tag)
        let expectedSPKI = hex("3059301306072a8648ce3d020106082a8648ce3d03010703420004" +
            "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296" +
            "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
        check(key.publicKey.derRepresentation == expectedSPKI, "P256 generator point must use canonical SPKI DER, not SEC1/raw bytes")
        check(credential.isValid && Data(base64Encoded: credential.publicKey) == expectedSPKI, "Enrollment uses canonical standard-base64 SPKI")
        check(credential.fingerprint == BazaarAppleCompletionCrypto.digest(expectedSPKI), "Server enrollment fingerprint is SHA256 of DER bytes")
        let message = Data("completion-test-only".utf8)
        let signature = try key.signature(for: message)
        check(signature.rawRepresentation.count == 64, "Server accepts P1363 raw r||s, never DER signatures")
        check(key.publicKey.isValidSignature(try P256.Signing.ECDSASignature(rawRepresentation: signature.rawRepresentation), for: message), "Raw P256/SHA256 signature verifies")
        check(!key.publicKey.isValidSignature(signature, for: Data("different challenge".utf8)), "A signature cannot be reused on another challenge")
        check(!BazaarAppleCompletionCredential(keyTag: tag, publicKey: key.publicKey.rawRepresentation.base64EncodedString(), fingerprint: credential.fingerprint).isValid, "Raw EC point cannot masquerade as SPKI")
        check(!BazaarAppleCompletionCredential(keyTag: tag, publicKey: credential.publicKey, fingerprint: String(repeating: "0", count: 64)).isValid, "Fingerprint mismatch fails closed")
        check(!BazaarAppleCompletionCredential(keyTag: "not-a-key-tag", publicKey: credential.publicKey, fingerprint: credential.fingerprint).isValid, "Key tags remain bounded opaque UUIDs")

        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent("bazaar-earned-completion-" + UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let file = root.appendingPathComponent("recovery/earned.json"), journal = BazaarAppleCompletionJournal(fileURL: file)
        let origin = BazaarBillingOrigin(configuredURL: URL(string: "https://www.bazaar.kg/dashboard")!, developmentBuild: false)!
        let preview = BazaarBillingOrigin(configuredURL: URL(string: "https://preview.example.invalid")!, developmentBuild: true)!
        let attempt = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let token = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        check(try journal.entries(for: origin).isEmpty, "Cold start cannot invent any earned result")
        let canceled = try journal.record(intentId: "cancel-intent", attemptId: attempt, origin: origin, credential: credential, outcome: .canceled)
        check(try journal.record(intentId: canceled.intentId, attemptId: attempt, origin: origin, credential: credential, outcome: .canceled) == canceled, "Earned cancellation persistence is idempotent")
        check(try BazaarAppleCompletionJournal(fileURL: file).entries(for: origin) == [canceled], "An earned result survives restart and a lost completion response")
        let other = try journal.record(intentId: canceled.intentId, attemptId: attempt, origin: preview, credential: credential, outcome: .notStarted)
        check(try journal.entries(for: preview) == [other], "Other trusted origins remain separate")
        mustFail("The same invocation cannot change its terminal assertion") {
            _ = try journal.record(intentId: canceled.intentId, attemptId: attempt, origin: origin, credential: credential, outcome: .notStarted)
        }
        let stored = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        let entries = stored["entries"] as! [[String: Any]]
        let storedKey = entries[0]["credential"] as! [String: Any]
        check(Set(storedKey.keys) == ["keyTag", "publicKey", "fingerprint"], "Private key bytes, account/session identifiers and cookies never enter the file")
        let fileAttributes = try manager.attributesOfItem(atPath: file.path)
        check((fileAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Signed evidence must be owner-readable only")
        let values = try file.resourceValues(forKeys: [.isExcludedFromBackupKey])
        check(values.isExcludedFromBackup == true, "Signed evidence journal is excluded from backups")
        let directoryAttributes = try manager.attributesOfItem(atPath: file.deletingLastPathComponent().path)
        check((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o700, "Recovery directory is owner-only")
        for response in ["{}", "{\"acknowledged\":true,\"kind\":\"CANCELED\",\"canceled\":1,\"recorded\":false}",
                         "{\"acknowledged\":false,\"kind\":\"PENDING\",\"recorded\":false}",
                         "{\"acknowledged\":true,\"kind\":\"RECORDED\",\"recorded\":true,\"status\":\"UNKNOWN\"}"] {
            check(try journal.applyAcknowledgement(Data(response.utf8), to: canceled) == .unresolved, "Only a strict durable ACK removes proof; pending/malformed responses do not")
        }
        check(try journal.entries(for: origin) == [canceled], "Unresolved results retain earned proof and its signing tag")
        let money = Data("{\"acknowledged\":true,\"kind\":\"RECORDED\",\"recorded\":true,\"status\":\"REVIEW\",\"reason\":\"fixture\"}".utf8)
        check(try journal.applyAcknowledgement(money, to: canceled) == .recorded, "Durable REVIEW money is never labelled cancellation or granted access")
        check(try journal.entries(for: origin).isEmpty && journal.entries(for: preview) == [other], "Money ACK clears only the matching redundant proof")

        let context = BazaarAppleDeferredContext(productId: "target-plan", subscriptionGroupId: "group", appAccountToken: token, environment: "Sandbox",
            authorizedAt: "2026-11-11T10:00:00.000Z", source: BazaarAppleDeferredSource(transactionId: "100", originalTransactionId: "99", productId: "old-plan", expiresAt: "2027-05-11T10:00:00.000Z"),
            signedTransactionInfo: jws("verified-old-success"), signedRenewalInfo: nil)
        let authDate = BazaarAppleCompletionPolicy.date(context.authorizedAt)!, expiry = BazaarAppleCompletionPolicy.date(context.source.expiresAt)!
        func sourceMatches(id: String = "100", original: String = "99", product: String = "old-plan", group: String? = "group",
            account: UUID? = UUID(uuidString: "33333333-3333-4333-8333-333333333333"), expires: Date? = BazaarAppleCompletionPolicy.date("2027-05-11T10:00:00Z"),
            purchased: Date = BazaarAppleCompletionPolicy.date("2026-10-11T10:00:00Z")!, revoked: Bool = false, upgraded: Bool = false, ownership: Bool = true) -> Bool {
            BazaarAppleCompletionPolicy.matchesSource(context, transactionId: id, originalTransactionId: original, productId: product, groupId: group, token: account,
                expiresAt: expires, purchaseDate: purchased, revoked: revoked, upgraded: upgraded, purchasedOwnership: ownership)
        }
        check(sourceMatches(), "Only the exact already-paid frozen source can explain deferred SDK success")
        for value in [sourceMatches(id: "101"), sourceMatches(original: "98"), sourceMatches(product: "target-plan"), sourceMatches(group: nil), sourceMatches(account: nil),
                      sourceMatches(expires: nil), sourceMatches(purchased: authDate.addingTimeInterval(1)), sourceMatches(revoked: true), sourceMatches(upgraded: true), sourceMatches(ownership: false)] {
            check(!value, "Wrong-source/new-money/family/revoked/upgraded results cannot become a deferred proof")
        }
        func renewalMatches(original: String = "99", product: String = "old-plan", target: String? = "target-plan",
            account: UUID? = UUID(uuidString: "33333333-3333-4333-8333-333333333333"), auto: Bool = true,
            renews: Date? = BazaarAppleCompletionPolicy.date("2027-05-11T10:00:00Z"), signed: Date = BazaarAppleCompletionPolicy.date("2026-11-11T10:00:01Z")!) -> Bool {
            BazaarAppleCompletionPolicy.matchesRenewal(context, originalTransactionId: original, currentProductId: product, nextProductId: target,
                token: account, willAutoRenew: auto, renewalDate: renews, signedDate: signed)
        }
        check(renewalMatches(), "Exact verified post-auth same-chain target renewal is eligible")
        for value in [renewalMatches(original: "98"), renewalMatches(product: "target-plan"), renewalMatches(target: nil), renewalMatches(account: nil),
                      renewalMatches(auto: false), renewalMatches(renews: nil), renewalMatches(signed: authDate.addingTimeInterval(-1)), renewalMatches(signed: expiry)] {
            check(!value, "Missing, older, wrong-chain, disabled or post-term renewal evidence cannot resolve the hold")
        }
        let deferred = try journal.record(intentId: "deferred-intent", attemptId: attempt, origin: origin, credential: credential, outcome: .deferred, deferred: context)
        check(try BazaarAppleCompletionJournal(fileURL: file).entries(for: origin)[0].deferred?.signedRenewalInfo == nil, "Persist actual verified SDK result before awaiting renewal status")
        let paired = try journal.attachRenewal(jws("verified-renewal"), to: deferred)
        check(paired.deferred?.signedTransactionInfo == context.signedTransactionInfo, "Pairing renewal never replaces the actually returned transaction JWS")
        check(try journal.attachRenewal(jws("verified-renewal"), to: paired) == paired, "The same captured evidence is idempotent")
        mustFail("A newer unrelated preference cannot overwrite captured proof") { _ = try journal.attachRenewal(jws("newer-preference"), to: paired) }
        let scheduledFalse = Data("{\"acknowledged\":true,\"kind\":\"DEFERRED\",\"deferred\":true,\"recorded\":false,\"scheduled\":false,\"intentId\":\"deferred-intent\",\"productId\":\"target-plan\",\"effectiveAt\":\"2027-05-11T10:00:00.000Z\"}".utf8)
        let wrongIntent = Data(String(data: scheduledFalse, encoding: .utf8)!.replacingOccurrences(of: "deferred-intent", with: "different-intent").utf8)
        check(try journal.applyAcknowledgement(wrongIntent, to: paired) == .unresolved, "Another intent's ACK cannot clear this proof")

        let now = authDate.addingTimeInterval(2), issued = Int64(now.timeIntervalSince1970 * 1000)
        func challenge(_ entry: BazaarAppleCompletionJournal.Entry, probe: Bool = false, changes: [String: Any] = [:]) throws -> (String, String) {
            var claims: [String: Any] = ["version": 1, "purpose": "bazaar.apple.completion.v1", "nonce": String(repeating: "a", count: 64),
                "intentId": entry.intentId, "attemptId": entry.attemptId.uuidString.lowercased(), "keyFingerprint": credential.fingerprint,
                "origin": entry.origin, "outcome": probe ? "RECORDED_ONLY" : entry.outcome.rawValue,
                "transactionDigest": NSNull(), "renewalDigest": NSNull(),
                "issuedAt": issued, "expiresAt": issued + 300_000]
            if !probe && entry.outcome == .deferred {
                claims["transactionDigest"] = BazaarAppleCompletionCrypto.digest(entry.deferred!.signedTransactionInfo)
                claims["renewalDigest"] = BazaarAppleCompletionCrypto.digest(entry.deferred!.signedRenewalInfo!)
            }
            for (key, value) in changes { claims[key] = value }
            let raw = try JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys]).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return (raw + "." + String(repeating: "s", count: 43), formatter.string(from: now.addingTimeInterval(300)))
        }
        let good = try challenge(paired)
        check(BazaarAppleCompletionChallenge.permits(good.0, expiresAt: good.1, entry: paired, now: now), "Sign only a fresh exact-purpose/nonce/scope/kind/evidence challenge")
        let substitutions: [[String: Any]] = [["intentId": "other"], ["attemptId": UUID().uuidString], ["keyFingerprint": String(repeating: "b", count: 64)],
                                     ["origin": preview.url.absoluteString], ["outcome": "CANCELED"], ["transactionDigest": String(repeating: "0", count: 64)],
                                     ["renewalDigest": String(repeating: "0", count: 64)], ["nonce": "bad"], ["purpose": "account-login"], ["issuedAt": -1]]
        for change in substitutions {
            let bad = try challenge(paired, changes: change)
            check(!BazaarAppleCompletionChallenge.permits(bad.0, expiresAt: bad.1, entry: paired, now: now), "Refuse scope substitution before signing")
        }
        check(!BazaarAppleCompletionChallenge.permits(good.0, expiresAt: good.1, entry: paired, now: now.addingTimeInterval(301)), "Expired challenge requires a fresh challenge, never a new purchase")
        let probe = try challenge(deferred, probe: true)
        check(BazaarAppleCompletionChallenge.permits(probe.0, expiresAt: probe.1, entry: deferred, recordedOnly: true, now: now), "Read-only money probe needs no fabricated renewal or terminal outcome")
        check(!BazaarAppleCompletionChallenge.permits(probe.0, expiresAt: probe.1, entry: deferred, now: now), "A money probe cannot attest deferred completion")
        check(try journal.applyAcknowledgement(scheduledFalse, to: paired) == .deferred(scheduled: false, effectiveAt: context.source.expiresAt), "Historical accepted proof is distinct from a currently scheduled preference")
        check(try journal.entries(for: origin).isEmpty, "Only a strict exact ACK releases local proof")
        check(BazaarAppleCompletionPolicy.environment(ofVerifiedJWS: jws("metadata-only")) == "Sandbox", "Verified JWS metadata supports minimum iOS15 without weakening server verification")

        let beforeCorruption = try Data(contentsOf: file)
        var unknownVersion = try JSONSerialization.jsonObject(with: beforeCorruption) as! [String: Any]
        unknownVersion["version"] = 2
        let unknownBytes = try JSONSerialization.data(withJSONObject: unknownVersion)
        try unknownBytes.write(to: file)
        mustFail("An unknown journal version is never silently migrated/reset") { _ = try journal.entries(for: preview) }
        check(try Data(contentsOf: file) == unknownBytes, "Unknown-version evidence is preserved byte-for-byte")
        try Data("not-json".utf8).write(to: file)
        mustFail("Corruption must not reset or overwrite proof") { _ = try journal.record(intentId: "new", attemptId: attempt, origin: origin, credential: credential, outcome: .canceled) }
        check(try Data(contentsOf: file) == Data("not-json".utf8), "Invalid journal remains available for support inspection")
        try beforeCorruption.write(to: file)
        let blocked = root.appendingPathComponent("not-a-directory"); try Data().write(to: blocked)
        mustFail("Storage failure must not be reported as durable completion") {
            _ = try BazaarAppleCompletionJournal(fileURL: blocked.appendingPathComponent("proof.json")).record(intentId: "new", attemptId: attempt, origin: origin, credential: credential, outcome: .notStarted)
        }
        print("Apple earned completion crypto/journal policy: \(checks) checks passed")
    }
}
