import CryptoKit
import Foundation
import Security

/// A completion key can only close one already authorized native invocation.
/// It is not an account/session key and is never given to JavaScript.
struct BazaarAppleCompletionCredential: Codable, Equatable, Hashable, Sendable {
    let keyTag: String
    let publicKey: String
    let fingerprint: String

    var isValid: Bool {
        guard UUID(uuidString: keyTag) != nil, keyTag == keyTag.lowercased(),
              let der = Data(base64Encoded: publicKey), der.base64EncodedString() == publicKey,
              publicKey.utf8.count <= 200,
              let key = try? P256.Signing.PublicKey(derRepresentation: der), key.derRepresentation == der else { return false }
        return fingerprint == BazaarAppleCompletionCrypto.digest(der)
    }
}

enum BazaarAppleCompletionCrypto {
    static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func digest(_ text: String) -> String { digest(Data(text.utf8)) }

    static func credential(for key: P256.Signing.PrivateKey, tag: String) -> BazaarAppleCompletionCredential {
        let der = key.publicKey.derRepresentation
        return BazaarAppleCompletionCredential(keyTag: tag, publicKey: der.base64EncodedString(), fingerprint: digest(der))
    }
}

/// No biometric prompt, synchronisation, access group or cloud backup is used.
/// After-first-unlock allows an earned result to finish after lock/backgrounding.
final class BazaarAppleCompletionKeychain {
    enum Failure: Error { case unavailable, invalidKey }
    private let service = "kg.bazaar.app.apple-native-completion.v1"

    func create() throws -> BazaarAppleCompletionCredential {
        let key = P256.Signing.PrivateKey()
        let credential = BazaarAppleCompletionCrypto.credential(for: key, tag: UUID().uuidString.lowercased())
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credential.keyTag,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: key.rawRepresentation,
        ]
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Failure.unavailable }
        return credential
    }

    func sign(_ challenge: String, with credential: BazaarAppleCompletionCredential) throws -> String {
        guard credential.isValid else { throw Failure.invalidKey }
        var query = identity(credential.keyTag)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let raw = result as? Data, let key = try? P256.Signing.PrivateKey(rawRepresentation: raw),
              BazaarAppleCompletionCrypto.credential(for: key, tag: credential.keyTag) == credential else { throw Failure.unavailable }
        // CryptoKit hashes the message with SHA-256. rawRepresentation is the
        // 64-byte P1363 r||s accepted by Node verify(sha256, ieee-p1363).
        return try key.signature(for: Data(challenge.utf8)).rawRepresentation.base64EncodedString()
    }

    func remove(_ credential: BazaarAppleCompletionCredential) throws {
        let result = SecItemDelete(identity(credential.keyTag) as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw Failure.unavailable }
    }

    private func identity(_ tag: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: tag, kSecAttrSynchronizable as String: false]
    }
}

struct BazaarAppleDeferredSource: Codable, Equatable, Hashable, Sendable {
    let transactionId: String
    let originalTransactionId: String
    let productId: String
    let expiresAt: String
}

struct BazaarAppleDeferredContext: Codable, Equatable, Hashable, Sendable {
    let productId: String
    let subscriptionGroupId: String
    let appAccountToken: UUID
    let environment: String
    let authorizedAt: String
    let source: BazaarAppleDeferredSource
    let signedTransactionInfo: String
    var signedRenewalInfo: String?

    var isValid: Bool {
        !productId.isEmpty && productId.utf8.count <= 255 && !subscriptionGroupId.isEmpty && subscriptionGroupId.utf8.count <= 100 &&
        ["Production", "Sandbox"].contains(environment) && source.productId != productId &&
        BazaarAppleCompletionPolicy.decimalId(source.transactionId) && BazaarAppleCompletionPolicy.decimalId(source.originalTransactionId) &&
        !source.productId.isEmpty && source.productId.utf8.count <= 255 &&
        BazaarAppleCompletionPolicy.date(authorizedAt) != nil && BazaarAppleCompletionPolicy.date(source.expiresAt) != nil &&
        BazaarAppleCompletionPolicy.evidence(signedTransactionInfo) && (signedRenewalInfo.map(BazaarAppleCompletionPolicy.evidence) ?? true)
    }
}

enum BazaarAppleCompletionPolicy {
    static func date(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    static func decimalId(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 40 && value.allSatisfy { $0.isASCII && $0.isNumber }
    }
    static func sameInstant(_ left: Date?, _ right: Date?) -> Bool {
        guard let left, let right else { return false }
        return (left.timeIntervalSince1970 * 1000).rounded() == (right.timeIntervalSince1970 * 1000).rounded()
    }
    static func evidence(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        return (30...100_000).contains(value.utf8.count) && parts.count == 3 && parts.allSatisfy { part in
            !part.isEmpty && part.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
        }
    }
    /// Read metadata only after StoreKit's verified result, never as verification.
    static func environment(ofVerifiedJWS signed: String) -> String? {
        guard evidence(signed) else { return nil }
        var part = String(signed.split(separator: ".")[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        part += String(repeating: "=", count: (4 - part.count % 4) % 4)
        guard let data = Data(base64Encoded: part), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["environment"] as? String
    }

    /// Exclusion only, after StoreKit VerificationResult.verified. The server
    /// independently checks the Apple certificates and frozen ledger/source.
    static func matchesSource(_ context: BazaarAppleDeferredContext, transactionId: String,
        originalTransactionId: String, productId: String, groupId: String?, token: UUID?,
        expiresAt: Date?, purchaseDate: Date, revoked: Bool, upgraded: Bool, purchasedOwnership: Bool
    ) -> Bool {
        guard context.isValid, let authorization = date(context.authorizedAt), let expiry = date(context.source.expiresAt) else { return false }
        return transactionId == context.source.transactionId && originalTransactionId == context.source.originalTransactionId &&
            productId == context.source.productId && groupId == context.subscriptionGroupId && token == context.appAccountToken &&
            sameInstant(expiresAt, expiry) && purchaseDate <= authorization && authorization < expiry && !revoked && !upgraded && purchasedOwnership
    }

    static func matchesRenewal(_ context: BazaarAppleDeferredContext, originalTransactionId: String,
        currentProductId: String, nextProductId: String?, token: UUID?, willAutoRenew: Bool,
        renewalDate: Date?, signedDate: Date
    ) -> Bool {
        guard context.isValid, let authorization = date(context.authorizedAt), let expiry = date(context.source.expiresAt) else { return false }
        return originalTransactionId == context.source.originalTransactionId && currentProductId == context.source.productId &&
            nextProductId == context.productId && token == context.appAccountToken && willAutoRenew &&
            sameInstant(renewalDate, expiry) && signedDate >= authorization && signedDate < expiry
    }
}

enum BazaarAppleCompletionKind: String, Codable, Hashable, Sendable { case canceled = "CANCELED", notStarted = "NOT_STARTED", deferred = "DEFERRED" }

/// Unlike the legacy cancellation journal, this separate protected file contains
/// sensitive signed evidence for an actually observed deferred StoreKit result.
/// Private key material, cookies and account passwords never enter this file.
final class BazaarAppleCompletionJournal {
    struct Entry: Codable, Equatable, Hashable, Sendable {
        let intentId: String
        let attemptId: UUID
        let origin: String
        let credential: BazaarAppleCompletionCredential
        let outcome: BazaarAppleCompletionKind
        var deferred: BazaarAppleDeferredContext?

        var sameInvocationKey: String { origin + "|" + intentId + "|" + attemptId.uuidString.lowercased() }
    }
    enum Failure: Error { case unavailable, invalidContents, invalidEntry, unsupportedVersion, tooLarge }
    enum Acknowledgement: Equatable {
        case canceled
        case deferred(scheduled: Bool, effectiveAt: String)
        case recorded
        case unresolved
    }
    private struct Document: Codable { let version: Int; let entries: [Entry] }
    private struct Response: Decodable {
        let acknowledged: Bool?
        let kind: String?
        let canceled: Bool?
        let recorded: Bool?
        let deferred: Bool?
        let scheduled: Bool?
        let intentId: String?
        let productId: String?
        let effectiveAt: String?
        let status: String?
    }
    private let fileURL: URL
    private let maximumBytes = 4_194_304
    init(fileURL: URL) { self.fileURL = fileURL }
    convenience init() throws {
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            self.init(fileURL: support.appendingPathComponent("AppleBillingRecovery", isDirectory: true).appendingPathComponent("earned-completions.json"))
        } catch { throw Failure.unavailable }
    }

    func entries(for origin: BazaarBillingOrigin) throws -> [Entry] { try load().filter { $0.origin == origin.url.absoluteString } }

    @discardableResult
    func record(intentId: String, attemptId: UUID, origin: BazaarBillingOrigin, credential: BazaarAppleCompletionCredential,
        outcome: BazaarAppleCompletionKind, deferred: BazaarAppleDeferredContext? = nil
    ) throws -> Entry {
        let entry = Entry(intentId: intentId, attemptId: attemptId, origin: origin.url.absoluteString, credential: credential, outcome: outcome, deferred: deferred)
        guard valid(entry) else { throw Failure.invalidEntry }
        var all = try load()
        if let existing = all.first(where: { $0.sameInvocationKey == entry.sameInvocationKey }) {
            guard existing == entry else { throw Failure.invalidEntry }
            return existing
        }
        guard all.count < 128 else { throw Failure.tooLarge }
        all.append(entry)
        try save(all)
        return entry
    }

    func attachRenewal(_ signed: String, to entry: Entry) throws -> Entry {
        guard entry.outcome == .deferred, BazaarAppleCompletionPolicy.evidence(signed) else { throw Failure.invalidEntry }
        var all = try load()
        guard let index = all.firstIndex(where: { $0.sameInvocationKey == entry.sameInvocationKey }), var proof = all[index].deferred else { throw Failure.invalidEntry }
        if let existing = proof.signedRenewalInfo {
            guard existing == signed else { throw Failure.invalidEntry }
            return all[index]
        }
        guard all[index] == entry else { throw Failure.invalidEntry }
        proof.signedRenewalInfo = signed
        all[index].deferred = proof
        try save(all)
        return all[index]
    }

    func applyAcknowledgement(_ data: Data, to entry: Entry) throws -> Acknowledgement {
        guard let response = try? JSONDecoder().decode(Response.self, from: data), response.acknowledged == true else { return .unresolved }
        let outcome: Acknowledgement
        if response.kind == "RECORDED", response.recorded == true, ["REVIEW", "COMPLETED"].contains(response.status ?? "") {
            outcome = .recorded
        } else if response.kind == "CANCELED", response.canceled == true, response.recorded == false, entry.outcome != .deferred {
            outcome = .canceled
        } else if response.kind == "DEFERRED", response.deferred == true, response.recorded == false,
                  entry.outcome == .deferred, response.intentId == entry.intentId, response.productId == entry.deferred?.productId,
                  let scheduled = response.scheduled, let effectiveAt = response.effectiveAt,
                  BazaarAppleCompletionPolicy.sameInstant(BazaarAppleCompletionPolicy.date(effectiveAt), entry.deferred.flatMap({ BazaarAppleCompletionPolicy.date($0.source.expiresAt) })) {
            outcome = .deferred(scheduled: scheduled, effectiveAt: effectiveAt)
        } else { return .unresolved }
        let all = try load()
        guard !all.contains(where: { $0.sameInvocationKey == entry.sameInvocationKey && $0 != entry }) else { throw Failure.invalidEntry }
        try save(all.filter { $0 != entry })
        return outcome
    }

    private func valid(_ entry: Entry) -> Bool {
        guard !entry.intentId.isEmpty, entry.intentId.utf8.count <= 80,
              entry.intentId.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
              let url = URL(string: entry.origin), entry.origin.utf8.count <= 2048,
              BazaarBillingOrigin(configuredURL: url, developmentBuild: true)?.url.absoluteString == entry.origin,
              entry.credential.isValid else { return false }
        return entry.outcome == .deferred ? entry.deferred?.isValid == true : entry.deferred == nil
    }

    private func load() throws -> [Entry] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        let data: Data
        do {
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            data = try handle.read(upToCount: maximumBytes + 1) ?? Data()
        } catch { throw Failure.unavailable }
        guard data.count <= maximumBytes else { throw Failure.tooLarge }
        guard let document = try? JSONDecoder().decode(Document.self, from: data) else { throw Failure.invalidContents }
        guard document.version == 1 else { throw Failure.unsupportedVersion }
        guard document.entries.count <= 128, document.entries.allSatisfy(valid),
              Set(document.entries.map(\.sameInvocationKey)).count == document.entries.count else { throw Failure.invalidContents }
        return document.entries
    }

    private func save(_ entries: [Entry]) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(Document(version: 1, entries: entries))
        guard data.count <= maximumBytes else { throw Failure.tooLarge }
        do {
            let directory = fileURL.deletingLastPathComponent()
            var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
            #if os(iOS)
            attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
            #endif
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
            try FileManager.default.setAttributes(attributes, ofItemAtPath: directory.path)
            var excluded = URLResourceValues(); excluded.isExcludedFromBackup = true
            var directoryURL = directory; try directoryURL.setResourceValues(excluded)
            var options: Data.WritingOptions = [.atomic]
            #if os(iOS)
            options.insert(.completeFileProtectionUntilFirstUserAuthentication)
            #endif
            try data.write(to: fileURL, options: options)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            var storedURL = fileURL; try storedURL.setResourceValues(excluded)
        } catch { throw Failure.unavailable }
    }
}

/// Parse only a server-issued, fixed-origin completion challenge and ensure this
/// key is never asked to sign a different invocation/kind/evidence pair.
enum BazaarAppleCompletionChallenge {
    private struct Claims: Decodable {
        let version: Int
        let purpose: String
        let nonce: String
        let intentId: String
        let attemptId: UUID
        let keyFingerprint: String
        let origin: String
        let outcome: String
        let transactionDigest: String?
        let renewalDigest: String?
        let issuedAt: Int64
        let expiresAt: Int64
    }
    static func permits(_ challenge: String, expiresAt: String, entry: BazaarAppleCompletionJournal.Entry, recordedOnly: Bool = false, now: Date = Date()) -> Bool {
        guard (30...3000).contains(challenge.utf8.count), entry.credential.isValid else { return false }
        let parts = challenge.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") } }) else { return false }
        var encoded = String(parts[0]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded), let claims = try? JSONDecoder().decode(Claims.self, from: data),
              claims.version == 1, claims.purpose == "bazaar.apple.completion.v1", claims.intentId == entry.intentId,
              claims.nonce.utf8.count == 64, claims.nonce.allSatisfy({ $0.isASCII && ($0.isNumber || ("a"..."f").contains(String($0))) }),
              claims.attemptId == entry.attemptId, claims.keyFingerprint == entry.credential.fingerprint, claims.origin == entry.origin,
              claims.outcome == (recordedOnly ? "RECORDED_ONLY" : entry.outcome.rawValue), claims.issuedAt > 0, claims.expiresAt > claims.issuedAt,
              claims.expiresAt - claims.issuedAt == 300_000,
              Date(timeIntervalSince1970: Double(claims.issuedAt) / 1000) <= now.addingTimeInterval(5),
              Date(timeIntervalSince1970: Double(claims.expiresAt) / 1000) > now,
              BazaarAppleCompletionPolicy.sameInstant(BazaarAppleCompletionPolicy.date(expiresAt), Date(timeIntervalSince1970: Double(claims.expiresAt) / 1000)) else { return false }
        if entry.outcome == .deferred && !recordedOnly {
            guard let proof = entry.deferred, let renewal = proof.signedRenewalInfo else { return false }
            return claims.transactionDigest == BazaarAppleCompletionCrypto.digest(proof.signedTransactionInfo) && claims.renewalDigest == BazaarAppleCompletionCrypto.digest(renewal)
        }
        return claims.transactionDigest == nil && claims.renewalDigest == nil
    }
}
