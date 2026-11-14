import Foundation

/// Only a definite OS cancellation or caught abort before invoking StoreKit
/// belongs here. Pending/unknown/verified SDK outcomes are never cancelled here.
final class BazaarAppleCancellationJournal {
    struct Entry: Codable, Hashable, Sendable {
        let intentId: String
        let origin: String
        // Missing only for preserved v1 entries. These cannot cancel a newly
        // authorized intent, because the server requires its winning attempt.
        let attemptId: UUID?
    }

    enum Failure: Error, Equatable {
        case storageUnavailable
        case invalidContents
        case unsupportedVersion
        case tooLarge
        case invalidEntry
    }

    enum Acknowledgement: Equatable {
        case canceled
        case recorded
        case unresolved
    }

    private struct ServerResponse: Decodable {
        let canceled: Bool
        let recorded: Bool
    }

    private struct Document: Codable {
        let version: Int
        var entries: [Entry]
    }

    private let fileURL: URL
    private let maximumBytes = 1_048_576

    init(fileURL: URL) {
        self.fileURL = fileURL
    }

    convenience init() throws {
        do {
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            )
            self.init(fileURL: support.appendingPathComponent("AppleBillingRecovery", isDirectory: true)
                .appendingPathComponent("cancelled-intents.json", isDirectory: false))
        } catch {
            throw Failure.storageUnavailable
        }
    }

    func entries(for origin: BazaarBillingOrigin) throws -> [Entry] {
        try load().filter { $0.origin == origin.url.absoluteString }
    }

    @discardableResult
    func record(intentId: String, origin: BazaarBillingOrigin, attemptId: UUID) throws -> Entry {
        let entry = Entry(intentId: intentId, origin: origin.url.absoluteString, attemptId: attemptId)
        guard valid(entry) else { throw Failure.invalidEntry }
        var entries = try load()
        if !entries.contains(entry) {
            entries.append(entry)
            try save(entries)
        }
        return entry
    }

    /// Only pass the scoped authenticated server response here. Invalid or lost
    /// responses never clear the entry. Recorded money is not a cancellation.
    func applyServerAcknowledgement(_ data: Data, for entry: Entry) throws -> Acknowledgement {
        guard let response = try? JSONDecoder().decode(ServerResponse.self, from: data) else { return .unresolved }
        let acknowledgement: Acknowledgement = response.recorded ? .recorded : response.canceled ? .canceled : .unresolved
        guard acknowledgement != .unresolved else { return .unresolved }
        let entries = try load()
        guard entries.contains(entry) else { return acknowledgement }
        try save(entries.filter { $0 != entry })
        return acknowledgement
    }

    private func valid(_ entry: Entry) -> Bool {
        guard !entry.intentId.isEmpty, entry.intentId.utf8.count <= 80,
              entry.intentId.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
              entry.origin.utf8.count <= 2048,
              let url = URL(string: entry.origin),
              let parsed = BazaarBillingOrigin(configuredURL: url, developmentBuild: true),
              parsed.url.absoluteString == entry.origin else { return false }
        return true
    }

    private func load() throws -> [Entry] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        let data: Data
        do {
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            data = try handle.read(upToCount: maximumBytes + 1) ?? Data()
        } catch {
            throw Failure.storageUnavailable
        }
        guard data.count <= maximumBytes else { throw Failure.tooLarge }
        guard let document = try? JSONDecoder().decode(Document.self, from: data) else {
            throw Failure.invalidContents
        }
        guard document.version == 1 || document.version == 2 else { throw Failure.unsupportedVersion }
        guard document.version != 1 || document.entries.allSatisfy({ $0.attemptId == nil }) else { throw Failure.invalidContents }
        guard document.entries.allSatisfy(valid), Set(document.entries).count == document.entries.count else {
            throw Failure.invalidContents
        }
        return document.entries
    }

    private func save(_ entries: [Entry]) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(Document(version: 2, entries: entries))
        guard data.count <= maximumBytes else { throw Failure.tooLarge }
        let directory = fileURL.deletingLastPathComponent()
        do {
            var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
            #if os(iOS)
            attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
            #endif
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
            try FileManager.default.setAttributes(attributes, ofItemAtPath: directory.path)
            var excluded = URLResourceValues()
            excluded.isExcludedFromBackup = true
            var directoryURL = directory
            try directoryURL.setResourceValues(excluded)
            var options: Data.WritingOptions = [.atomic]
            #if os(iOS)
            options.insert(.completeFileProtectionUntilFirstUserAuthentication)
            #endif
            try data.write(to: fileURL, options: options)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            var storedURL = fileURL
            try storedURL.setResourceValues(excluded)
        } catch {
            throw Failure.storageUnavailable
        }
    }
}

/// This boundary is shared by the real purchase path and executable regression
/// checks. Once invoke begins, its errors can never enter the pre-sheet handler.
enum BazaarApplePreSheetAttempt {
    @MainActor static func perform<Authorization, Prepared, Result>(
        authorize: @MainActor () async throws -> Authorization,
        prepare: @MainActor (Authorization) async throws -> Prepared,
        invoke: @MainActor (Prepared) async throws -> Result,
        abort: @MainActor (Error) async throws -> Result
    ) async throws -> Result {
        let prepared: Prepared
        do {
            let authorization = try await authorize()
            prepared = try await prepare(authorization)
        } catch {
            return try await abort(error)
        }
        return try await invoke(prepared)
    }
}
