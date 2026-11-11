import Capacitor
import WebKit

/// Capacitor's normal handler does not expose a caller's frame to CAPPluginCall.
/// Filter before that information is lost. Protect the whole bridge because
/// dynamic plugin aliases and callbacks must not bypass billing's frame check.
private final class BazaarNativeMessageGuard: NSObject, WKScriptMessageHandler {
    weak var downstream: WKScriptMessageHandler?
    weak var webView: WKWebView?
    let origin: BazaarBillingOrigin?

    init(downstream: WKScriptMessageHandler, webView: WKWebView, origin: BazaarBillingOrigin?) {
        self.downstream = downstream
        self.webView = webView
        self.origin = origin
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let source = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, let origin,
              origin.matches(scheme: source.protocol, host: source.host, port: source.port),
              origin.matches(webView?.url) else { return }
        downstream?.userContentController(userContentController, didReceive: message)
    }
}

@objc(BazaarBridgeViewController)
final class BazaarBridgeViewController: CAPBridgeViewController {
    private var nativeMessageGuard: BazaarNativeMessageGuard?

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        // Capacitor otherwise prints portions of native results in DEBUG builds,
        // including signed billing evidence. Keep those records out of logs.
        descriptor.loggingBehavior = .none
        if BazaarNativeBuildChannel.compiled != .development {
            // Refuse a mismatched bundled config before WebKit loads any remote
            // page, rather than merely disabling its bridge after navigation.
            guard let raw = descriptor.serverURL, let url = URL(string: raw),
                  let origin = BazaarNativeBuildChannel.compiled.trustedOrigin(configuredURL: url),
                  Bundle.main.object(forInfoDictionaryKey: "BazaarBuildChannel") as? String == BazaarNativeBuildChannel.compiled.rawValue else {
                descriptor.serverURL = nil
                descriptor.allowedNavigationHostnames = []
                return descriptor
            }
            descriptor.allowedNavigationHostnames = [origin.host]
            descriptor.isWebDebuggable = false
        }
        #if DEBUG
        if ProcessInfo.processInfo.environment["BAZAAR_NATIVE_STOREKIT_TESTS"] == "1" {
            // UIKit can instantiate the storyboard controller before SceneDelegate.
            // Keep that discarded test-host controller local as well.
            descriptor.serverURL = nil
            descriptor.allowedNavigationHostnames = []
        }
        #endif
        return descriptor
    }

    override func capacitorDidLoad() {
        guard let capacitorBridge = bridge as? CapacitorBridge, let webView else { return }
        let origin = BazaarNativeBuildChannel.compiled.trustedOrigin(configuredURL: capacitorBridge.config.serverURL)
        let messageGuard = BazaarNativeMessageGuard(
            downstream: capacitorBridge.webViewDelegationHandler,
            webView: webView,
            origin: origin
        )
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "bridge")
        controller.add(messageGuard, name: "bridge")
        nativeMessageGuard = messageGuard
        capacitorBridge.registerPluginInstance(BazaarAppleBillingPlugin())
    }
}
