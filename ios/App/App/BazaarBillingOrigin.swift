import Foundation

#if BAZAAR_STAGING && DEBUG
#error("The fixed staging Release channel must not enable DEBUG.")
#endif

enum BazaarNativeBuildChannel: String {
    case development
    case production
    case stagingTestFlight = "staging-testflight"

    static let stagingOrigin = "https://bazaar-ios-preview-20261111.vercel.app"

    static var compiled: Self {
        #if BAZAAR_STAGING
        return .stagingTestFlight
        #elseif DEBUG
        return .development
        #else
        return .production
        #endif
    }

    func trustedOrigin(configuredURL: URL) -> BazaarBillingOrigin? {
        switch self {
        case .development:
            return BazaarBillingOrigin(configuredURL: configuredURL, developmentBuild: true)
        case .production:
            return BazaarBillingOrigin(configuredURL: configuredURL, developmentBuild: false)
        case .stagingTestFlight:
            guard let origin = BazaarBillingOrigin(configuredURL: configuredURL, developmentBuild: true),
                  origin.url.absoluteString == Self.stagingOrigin else { return nil }
            return origin
        }
    }

    func permitsTransactionEnvironment(_ environment: String?) -> Bool {
        self != .stagingTestFlight || environment == "Sandbox"
    }

    /// Exclusion only: callers must already hold StoreKit-verified evidence.
    /// iOS 15 lacks Transaction.environment; its verified JWS supplies that field.
    func permitsVerifiedTransaction(platformEnvironment: String?, signed: String) -> Bool {
        if self != .stagingTestFlight { return true }
        if let platformEnvironment { return permitsTransactionEnvironment(platformEnvironment) }
        guard signed.utf8.count <= 262_144 else { return false }
        let parts = signed.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return false }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return permitsTransactionEnvironment(payload["environment"] as? String)
    }
}

/// This boundary is compiled into the app. JavaScript cannot choose an API origin.
struct BazaarBillingOrigin: Equatable {
    let scheme: String
    let host: String
    let port: Int
    let url: URL
    private let developmentBuild: Bool

    init?(configuredURL: URL, developmentBuild: Bool) {
        guard let scheme = configuredURL.scheme?.lowercased(),
              let host = configuredURL.host?.lowercased(),
              configuredURL.user == nil, configuredURL.password == nil,
              scheme == "https" || (developmentBuild && scheme == "http") else { return nil }
        let port = configuredURL.port ?? (scheme == "https" ? 443 : 80)
        guard (1...65535).contains(port) else { return nil }
        guard developmentBuild || (scheme == "https" && host == "www.bazaar.kg" && port == 443) else {
            return nil
        }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        if port != (scheme == "https" ? 443 : 80) { components.port = port }
        guard let originURL = components.url else { return nil }
        self.scheme = scheme
        self.host = host
        self.port = port
        self.url = originURL
        self.developmentBuild = developmentBuild
    }

    func matches(_ url: URL?) -> Bool {
        guard let url, url.user == nil, url.password == nil,
              let scheme = url.scheme, let host = url.host else { return false }
        return matches(scheme: scheme, host: host, port: url.port ?? 0)
    }

    func matches(scheme: String, host: String, port: Int) -> Bool {
        let scheme = scheme.lowercased()
        let effectivePort = port == 0 ? (scheme == "https" ? 443 : 80) : port
        return self.scheme == scheme && self.host == host.lowercased() && self.port == effectivePort
    }

    /// Only session cookies are copied from WKWebView, never its entire cookie jar.
    func sessionCookies(_ cookies: [HTTPCookie], now: Date = Date()) -> [HTTPCookie] {
        let secureName = "__Secure-next-auth.session-token"
        let baseNames = scheme == "https"
            ? (developmentBuild ? [secureName, "next-auth.session-token"] : [secureName])
            : ["next-auth.session-token"]
        return cookies.filter { cookie in
            let isSession = baseNames.contains { baseName in
                cookie.name == baseName || (
                    cookie.name.hasPrefix(baseName + ".") &&
                    !cookie.name.dropFirst(baseName.count + 1).isEmpty &&
                    cookie.name.dropFirst(baseName.count + 1).allSatisfy { $0.isASCII && $0.isNumber }
                )
            }
            return isSession && isScoped(cookie, now: now) &&
                (!cookie.name.hasPrefix(secureName) || cookie.isSecure) &&
                cookie.path == "/"
        }
    }

    func hasImpersonationSession(_ cookies: [HTTPCookie], now: Date = Date()) -> Bool {
        cookies.contains { $0.name == "impersonation_session" && isScoped($0, now: now) }
    }

    private func isScoped(_ cookie: HTTPCookie, now: Date) -> Bool {
        let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()).lowercased() : cookie.domain.lowercased()
        let matchesDomain = cookie.domain.hasPrefix(".")
            ? (host == domain || host.hasSuffix("." + domain)) : host == domain
        return matchesDomain && (!cookie.isSecure || scheme == "https") &&
            (cookie.expiresDate.map { $0 > now } ?? true)
    }
}

/// The same Apple Account may manage several Bazaar organizations. An existing
/// auto-renewable group must keep its original organization's stable token.
enum BazaarAppleSubscriptionPolicy {
    static func permitsPurchase(
        selectedGroupId: String,
        selectedAccountToken: UUID,
        entitlementGroupId: String?,
        entitlementAccountToken: UUID?,
        verified: Bool
    ) -> Bool {
        // Neither an unverified payload nor a missing group can prove that a
        // purchase is unrelated to the group Apple is about to change.
        guard verified, let entitlementGroupId, !entitlementGroupId.isEmpty else { return false }
        if entitlementGroupId != selectedGroupId { return true }
        return entitlementAccountToken == selectedAccountToken
    }
}
