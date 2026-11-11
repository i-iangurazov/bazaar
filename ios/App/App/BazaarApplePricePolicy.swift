import Foundation

/// These fields come only from the fixed-origin server authorization. JavaScript
/// cannot supply or change a purchase price constraint through the native bridge.
struct BazaarApplePriceConstraint: Decodable, Equatable, Sendable {
    let storefrontId: String
    let currency: String
    let priceMillis: String

    var isValid: Bool {
        !storefrontId.isEmpty && storefrontId.utf8.count <= 40 &&
        storefrontId.allSatisfy { $0.isASCII && $0.isNumber } &&
        currency.utf8.count == 3 && currency.allSatisfy { $0.isASCII && $0.isUppercase } &&
        !priceMillis.isEmpty && priceMillis.utf8.count <= 30 && (priceMillis == "0" || priceMillis.first != "0") &&
        priceMillis.allSatisfy { $0.isASCII && $0.isNumber }
    }
}

enum BazaarApplePricePolicy {
    /// Decimal-only display/preflight metadata, never proof that Apple charged.
    static func priceMillis(_ price: Decimal) -> String? {
        var source = price
        var multiplier = Decimal(1000)
        var result = Decimal.zero
        guard NSDecimalMultiply(&result, &source, &multiplier, .plain) == .noError else { return nil }
        let raw = NSDecimalNumber(decimal: result).stringValue
        guard !raw.isEmpty, raw.utf8.count <= 30,
              raw.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return raw
    }

    static func permits(
        _ constraint: BazaarApplePriceConstraint?, storefrontId: String?,
        currency: String, price: Decimal
    ) -> Bool {
        // Existing automatic/full-period offers have no C price fence and retain
        // their original behavior, including an unavailable storefront query.
        guard let constraint else { return true }
        return constraint.isValid && constraint.storefrontId == storefrontId &&
            constraint.currency == currency && constraint.priceMillis == priceMillis(price)
    }
}
