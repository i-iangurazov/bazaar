import Foundation

/// Compile with the production source; never copy a substitute policy into tests.
@main
struct AppleBillingPolicyChecks {
    static func main() {
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            precondition(condition(), message)
            checks += 1
        }
        func origin(_ raw: String, development: Bool = false) -> BazaarBillingOrigin? {
            BazaarBillingOrigin(configuredURL: URL(string: raw)!, developmentBuild: development)
        }
        #if BAZAAR_STAGING
        check(BazaarNativeBuildChannel.compiled == .stagingTestFlight, "Staging must select its compiled channel without DEBUG")
        #elseif DEBUG
        check(BazaarNativeBuildChannel.compiled == .development, "DEBUG must remain an explicit development channel")
        #else
        check(BazaarNativeBuildChannel.compiled == .production, "Normal Release must select the production channel")
        #endif
        let production = origin("https://www.bazaar.kg/dashboard")!
        check(production.matches(URL(string: "https://www.bazaar.kg/en/billing")), "Trusted path must work")
        check(production.matches(URL(string: "https://www.bazaar.kg:443/dashboard")), "Default ports must normalize")
        check(production.matches(scheme: "https", host: "www.bazaar.kg", port: 0), "WKSecurityOrigin default port must work")
        for raw in ["https://www.bazaar.kg.evil.invalid", "https://bazaar.kg", "https://evil.invalid", "http://www.bazaar.kg", "https://www.bazaar.kg:444", "capacitor://localhost", "https://user:password@www.bazaar.kg"] {
            check(!production.matches(URL(string: raw)), "Reject untrusted navigation: \(raw)")
            check(origin(raw) == nil, "Production must reject untrusted compiled configuration: \(raw)")
        }
        check(!production.matches(nil), "No loaded page must fail closed")
        check(production.url.absoluteString == "https://www.bazaar.kg", "Do not send dashboard paths in Origin")
        let development = origin("http://localhost:3136/dashboard", development: true)!
        check(development.matches(URL(string: "http://localhost:3136/billing")), "Compiled development origin must work")
        check(!development.matches(URL(string: "http://localhost:3137/billing")), "Development ports must remain exact")
        check(!development.matches(URL(string: "http://127.0.0.1:3136/billing")), "No implicit loopback aliases")
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func cookie(_ name: String, domain: String = "www.bazaar.kg", path: String = "/", secure: Bool = true, expires: Date? = nil) -> HTTPCookie {
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: name, .value: "synthetic-test-only", .domain: domain, .path: path,
            ]
            if secure { properties[.secure] = "TRUE" }
            if let expires { properties[.expires] = expires }
            return HTTPCookie(properties: properties)!
        }
        let session = "__Secure-next-auth.session-token"
        let input = [
            cookie(session), cookie(session + ".0"), cookie(session + ".1", domain: ".bazaar.kg"),
            cookie(session, domain: "www.bazaar.kg.evil.invalid"), cookie(session, domain: ".evil.invalid"),
            cookie(session, path: "/admin"), cookie(session, expires: now.addingTimeInterval(-1)),
            cookie(session, secure: false), cookie(session + "."), cookie(session + ".evil"),
            cookie("next-auth.session-token", secure: false), cookie("__Host-next-auth.csrf-token"), cookie("analytics"),
        ]
        check(production.sessionCookies(input, now: now).map(\.name) == [session, session + ".0", session + ".1"], "Only in-scope, live session cookie chunks may leave WebKit")
        let devCookies = [cookie("next-auth.session-token", domain: "localhost", secure: false), cookie(session, domain: "localhost")]
        check(development.sessionCookies(devCookies, now: now).map(\.name) == ["next-auth.session-token"], "Never send secure cookies over HTTP")
        let httpsDevelopment = origin("https://preview.example.invalid/dashboard", development: true)!
        check(httpsDevelopment.sessionCookies([cookie("next-auth.session-token", domain: "preview.example.invalid", secure: false)], now: now).count == 1, "Development HTTPS can use a development session")
        check(production.hasImpersonationSession([cookie("impersonation_session")], now: now), "Impersonation must fail closed before copying session cookies")
        check(!production.hasImpersonationSession([cookie("impersonation_session", domain: "evil.invalid"), cookie("impersonation_session", expires: now.addingTimeInterval(-1))], now: now), "Unrelated or expired cookies must not masquerade as impersonation")
        let organizationA = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let organizationB = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        func canPurchase(_ group: String?, token: UUID?, verified: Bool = true) -> Bool {
            BazaarAppleSubscriptionPolicy.permitsPurchase(
                selectedGroupId: "bazaar-test-group", selectedAccountToken: organizationA,
                entitlementGroupId: group, entitlementAccountToken: token, verified: verified
            )
        }
        check(canPurchase("bazaar-test-group", token: organizationA), "An existing same-organization group may change plan")
        check(!canPurchase("bazaar-test-group", token: organizationB), "Never change another organization's active Apple group")
        check(!canPurchase("bazaar-test-group", token: nil), "Missing account tokens cannot prove group ownership")
        check(canPurchase("unrelated-apple-group", token: organizationB), "A verified different group does not block this purchase")
        check(!canPurchase(nil, token: organizationA), "Missing subscription group fails closed")
        check(!canPurchase("unrelated-apple-group", token: organizationA, verified: false), "Unverified data cannot prove a group is unrelated")
        let staging = BazaarNativeBuildChannel.stagingTestFlight
        let stageURL = BazaarNativeBuildChannel.stagingOrigin
        check(staging.trustedOrigin(configuredURL: URL(string: stageURL + "/dashboard")!) != nil, "Dedicated staging Release trusts its fixed preview")
        check(staging.trustedOrigin(configuredURL: URL(string: stageURL + ":443/login")!) != nil, "Staging canonical default port remains valid")
        for raw in ["https://www.bazaar.kg", "https://arbitrary.example.invalid", stageURL + ".evil.invalid", stageURL + ":444", stageURL.replacingOccurrences(of: "https:", with: "http:")] {
            check(staging.trustedOrigin(configuredURL: URL(string: raw)!) == nil, "No production, arbitrary, alias, cleartext or alternate-port staging origin: \(raw)")
        }
        check(BazaarNativeBuildChannel.production.trustedOrigin(configuredURL: URL(string: stageURL)!) == nil, "Production Release never trusts the staging host")
        check(staging.permitsTransactionEnvironment("Sandbox"), "Staging requires server-selected Sandbox authorization")
        check(!staging.permitsTransactionEnvironment("Production") && !staging.permitsTransactionEnvironment(nil), "Staging fails closed on a missing or production authorization environment")
        check(BazaarNativeBuildChannel.production.permitsTransactionEnvironment("Sandbox"), "Normal production supports server-controlled Sandbox review organizations")
        func signedEnvironment(_ environment: String) -> String {
            let payload = Data("{\"environment\":\"\(environment)\"}".utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            return "synthetic.\(payload).evidence"
        }
        check(staging.permitsVerifiedTransaction(platformEnvironment: "Sandbox", signed: ""), "Platform Sandbox environment is sufficient for this exclusion filter")
        check(!staging.permitsVerifiedTransaction(platformEnvironment: "Production", signed: signedEnvironment("Sandbox")), "JWS fallback must not override a known platform environment")
        check(staging.permitsVerifiedTransaction(platformEnvironment: nil, signed: signedEnvironment("Sandbox")), "iOS 15 can filter already-verified Sandbox evidence")
        check(!staging.permitsVerifiedTransaction(platformEnvironment: nil, signed: signedEnvironment("Production")), "Never forward production evidence to the isolated preview")
        check(!staging.permitsVerifiedTransaction(platformEnvironment: nil, signed: signedEnvironment("Xcode")), "Synthetic StoreKit configuration is not a real Sandbox transaction")
        check(!staging.permitsVerifiedTransaction(platformEnvironment: nil, signed: "bad.evidence"), "Missing evidence fails closed in staging")
        check(!staging.permitsVerifiedTransaction(platformEnvironment: nil, signed: "a.@@@.b"), "Malformed verified-payload fallback cannot pass the filter")
        check(!staging.permitsVerifiedTransaction(platformEnvironment: nil, signed: String(repeating: "a", count: 262_145)), "Fallback parsing remains bounded")
        print("Apple billing origin, cookie and channel policy: \(checks) checks passed")
    }
}
