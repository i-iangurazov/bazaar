import Foundation

/// Production Decimal policy only: no StoreKit connection or provider request.
@main
struct ApplePricePolicyChecks {
    static func main() {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ message: String) {
            precondition(value(), message)
            checks += 1
        }
        func decimal(_ raw: String) -> Decimal { Decimal(string: raw, locale: Locale(identifier: "en_US_POSIX"))! }
        func constraint(_ id: String = "123456", _ currency: String = "USD", _ millis: String = "2990") -> BazaarApplePriceConstraint {
            BazaarApplePriceConstraint(storefrontId: id, currency: currency, priceMillis: millis)
        }
        let expected = constraint()
        for type in ["NON_RENEWING", "CONSUMABLE", "AUTO_RENEWABLE"] {
            check(BazaarApplePricePolicy.permitsProductType(expected: type, actual: type), "Exact authorized sale type remains eligible")
            for other in ["NON_RENEWING", "CONSUMABLE", "AUTO_RENEWABLE"].filter({ $0 != type }) {
                check(!BazaarApplePricePolicy.permitsProductType(expected: type, actual: other), "A matching price cannot replace the authorized product type")
            }
        }
        check(!BazaarApplePricePolicy.permitsProductType(expected: nil, actual: "NON_RENEWING"), "Constrained metadata requires the server's authorized type")
        check(!BazaarApplePricePolicy.permitsProductType(expected: "NON_CONSUMABLE", actual: "NON_CONSUMABLE"), "Unapproved nonconsumables cannot enter the constrained sale flow")
        check(expected.isValid, "Server price constraints use exact canonical fields")
        check(BazaarApplePricePolicy.priceMillis(decimal("2.99")) == "2990", "No binary floating-point rounding")
        check(BazaarApplePricePolicy.priceMillis(decimal("1.005")) == "1005", "Preserve three decimal currency units exactly")
        check(BazaarApplePricePolicy.priceMillis(decimal("0")) == "0", "Zero metadata remains canonical and nonnegative")
        check(BazaarApplePricePolicy.priceMillis(decimal("2.9900")) == "2990", "Equivalent Decimal scales normalize")
        check(BazaarApplePricePolicy.priceMillis(decimal("0.0001")) == nil, "Never round an unsupported fractional milliunit into eligibility")
        check(BazaarApplePricePolicy.priceMillis(decimal("-1")) == nil, "Negative money cannot pass")
        check(BazaarApplePricePolicy.priceMillis(.nan) == nil, "Invalid Decimal metadata fails closed")
        check(BazaarApplePricePolicy.permits(expected, storefrontId: "123456", currency: "USD", price: decimal("2.99")), "Exact storefront/currency/price is eligible")
        check(!BazaarApplePricePolicy.permits(expected, storefrontId: nil, currency: "USD", price: decimal("2.99")), "Missing storefront blocks C")
        check(!BazaarApplePricePolicy.permits(expected, storefrontId: "999999", currency: "USD", price: decimal("2.99")), "Country code or another storefront cannot substitute for ID")
        check(!BazaarApplePricePolicy.permits(expected, storefrontId: "123456", currency: "EUR", price: decimal("2.99")), "No invented currency equivalence")
        check(!BazaarApplePricePolicy.permits(expected, storefrontId: "123456", currency: "USD", price: decimal("3.00")), "A raised Apple price requires fresh consent")
        check(!BazaarApplePricePolicy.permits(expected, storefrontId: "123456", currency: "USD", price: decimal("2.98")), "A changed lower price also invalidates the frozen constraint")
        check(constraint("123456", "USD", "0").isValid, "Zero is a valid numeric representation; commercial eligibility belongs to the server")
        check(BazaarApplePricePolicy.permits(nil, storefrontId: nil, currency: "USD", price: decimal("2.99")), "Unconstrained old renewal products remain usable without storefront metadata")
        for value in [constraint("KGZ"), constraint(""), constraint("123456", "usd"), constraint("123456", "US"), constraint("123456", "USD", "02990"), constraint("123456", "USD", "2.990"), constraint("123456", "USD", "2e3"), constraint("123456", "USD", "-2990"), constraint("123456", "USD", String(repeating: "9", count: 31))] {
            check(!value.isValid, "Malformed/unbounded constraint fails closed")
            check(!BazaarApplePricePolicy.permits(value, storefrontId: "123456", currency: "USD", price: decimal("2.99")), "Invalid constraint must not behave as an absent constraint")
        }
        let malformed = Data("{\"storefrontId\":\"123456\",\"currency\":\"USD\",\"priceMillis\":2990}".utf8)
        check((try? JSONDecoder().decode(BazaarApplePriceConstraint.self, from: malformed)) == nil, "JSON numbers cannot replace exact milliunit strings")
        print("Apple Decimal price/storefront policy: \(checks) checks passed")
    }
}
