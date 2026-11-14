import Capacitor
import UIKit
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
    private var startupCoordinator: BazaarStartupCoordinator?

    override var preferredStatusBarStyle: UIStatusBarStyle {
        startupCoordinator?.coversWebContent == true ? .darkContent : super.preferredStatusBarStyle
    }

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
        #if DEBUG
        if ProcessInfo.processInfo.environment["BAZAAR_NATIVE_STOREKIT_TESTS"] == "1" { return }
        #endif
        // Install before CAPBridgeViewController.viewDidLoad starts the first
        // navigation. The normal Capacitor navigation delegate remains intact.
        view.backgroundColor = .white
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        startupCoordinator = BazaarStartupCoordinator(
            webView: webView, parent: view, origin: origin,
            launchURL: origin?.matches(capacitorBridge.config.serverURL) == true ? capacitorBridge.config.serverURL : nil,
            stateDidChange: { [weak self] in self?.setNeedsStatusBarAppearanceUpdate() }
        )
    }
}

private enum BazaarStartupCopy {
    private static var language: String {
        (Bundle.main.preferredLocalizations.first ?? Locale.preferredLanguages.first ?? "en")
            .split(separator: "-").first.map(String.init) ?? "en"
    }
    private static func text(_ ru: String, _ ky: String, _ en: String) -> String {
        switch language {
        case "ru": return ru
        case "ky", "kg": return ky
        default: return en
        }
    }
    static var loading: String { text("Открываем Bazaar", "Bazaar ачылууда", "Opening Bazaar") }
    static var failureTitle: String { text("Не удалось открыть Bazaar", "Bazaar ачылган жок", "Could not open Bazaar") }
    static var failureMessage: String {
        text("Проверьте подключение и попробуйте снова.",
             "Интернет байланышын текшерип, кайра аракет кылыңыз.",
             "Check your connection and try again.")
    }
    static var configurationMessage: String {
        text("Эта сборка не может открыть настроенный адрес. Установите актуальную версию Bazaar.",
             "Бул түзүмдө көрсөтүлгөн дарек ачылбайт. Bazaar колдонмосунун акыркы нускасын орнотуңуз.",
             "This build cannot open its configured address. Install the latest version of Bazaar.")
    }
    static var retry: String { text("Повторить", "Кайра аракет кылуу", "Try again") }
}

@MainActor
private final class BazaarStartupCover: UIView {
    private let logo = UIImageView(image: UIImage(named: "StartupLogo"))
    private let dots = (0..<3).map { _ in UIView() }
    private let failureScroll = UIScrollView()
    private let failureStack = UIStackView()
    private let failureTitle = UILabel()
    private let failureMessage = UILabel()
    private let retryButton = UIButton(type: .system)
    var retry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        isOpaque = true
        accessibilityViewIsModal = true
        accessibilityIdentifier = "bazaar.startup"
        logo.contentMode = .scaleAspectFit
        logo.isAccessibilityElement = false
        addSubview(logo)
        for dot in dots {
            dot.backgroundColor = UIColor(red: 11 / 255, green: 99 / 255, blue: 206 / 255, alpha: 1)
            dot.layer.cornerRadius = 3
            dot.isAccessibilityElement = false
            addSubview(dot)
        }
        let errorLogo = UIImageView(image: UIImage(named: "StartupLogo"))
        errorLogo.contentMode = .scaleAspectFit
        errorLogo.heightAnchor.constraint(equalToConstant: 80).isActive = true
        errorLogo.isAccessibilityElement = false
        failureTitle.text = BazaarStartupCopy.failureTitle
        failureTitle.font = .preferredFont(forTextStyle: .headline)
        failureTitle.adjustsFontForContentSizeCategory = true
        failureTitle.textColor = UIColor(red: 23 / 255, green: 35 / 255, blue: 55 / 255, alpha: 1)
        failureTitle.textAlignment = .center
        failureTitle.numberOfLines = 0
        failureTitle.accessibilityTraits = .header
        failureMessage.font = .preferredFont(forTextStyle: .subheadline)
        failureMessage.adjustsFontForContentSizeCategory = true
        failureMessage.textColor = UIColor(red: 85 / 255, green: 99 / 255, blue: 119 / 255, alpha: 1)
        failureMessage.textAlignment = .center
        failureMessage.numberOfLines = 0
        retryButton.setTitle(BazaarStartupCopy.retry, for: .normal)
        retryButton.setTitleColor(.white, for: .normal)
        retryButton.backgroundColor = UIColor(red: 11 / 255, green: 99 / 255, blue: 206 / 255, alpha: 1)
        retryButton.layer.cornerRadius = 12
        retryButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        retryButton.titleLabel?.adjustsFontForContentSizeCategory = true
        retryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        retryButton.accessibilityIdentifier = "bazaar.startup.retry"
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        failureStack.axis = .vertical
        failureStack.spacing = 16
        failureStack.addArrangedSubview(errorLogo)
        failureStack.addArrangedSubview(failureTitle)
        failureStack.addArrangedSubview(failureMessage)
        failureStack.addArrangedSubview(retryButton)
        failureStack.translatesAutoresizingMaskIntoConstraints = false
        failureScroll.translatesAutoresizingMaskIntoConstraints = false
        failureScroll.alwaysBounceVertical = false
        addSubview(failureScroll)
        let failureContent = UIView()
        failureContent.translatesAutoresizingMaskIntoConstraints = false
        failureScroll.addSubview(failureContent)
        failureContent.addSubview(failureStack)
        let preferredWidth = failureStack.widthAnchor.constraint(equalToConstant: 340)
        preferredWidth.priority = .defaultHigh
        let preferredHeight = failureContent.heightAnchor.constraint(equalTo: failureScroll.frameLayoutGuide.heightAnchor)
        preferredHeight.priority = .defaultLow
        NSLayoutConstraint.activate([
            failureScroll.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
            failureScroll.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
            failureScroll.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
            failureScroll.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
            failureContent.topAnchor.constraint(equalTo: failureScroll.contentLayoutGuide.topAnchor),
            failureContent.bottomAnchor.constraint(equalTo: failureScroll.contentLayoutGuide.bottomAnchor),
            failureContent.leadingAnchor.constraint(equalTo: failureScroll.contentLayoutGuide.leadingAnchor),
            failureContent.trailingAnchor.constraint(equalTo: failureScroll.contentLayoutGuide.trailingAnchor),
            failureContent.widthAnchor.constraint(equalTo: failureScroll.frameLayoutGuide.widthAnchor),
            failureContent.heightAnchor.constraint(greaterThanOrEqualTo: failureScroll.frameLayoutGuide.heightAnchor),
            preferredHeight,
            failureStack.centerXAnchor.constraint(equalTo: failureContent.centerXAnchor),
            failureStack.centerYAnchor.constraint(equalTo: failureContent.centerYAnchor),
            failureStack.topAnchor.constraint(greaterThanOrEqualTo: failureContent.topAnchor, constant: 16),
            failureStack.bottomAnchor.constraint(lessThanOrEqualTo: failureContent.bottomAnchor, constant: -16),
            failureStack.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            failureStack.widthAnchor.constraint(lessThanOrEqualTo: failureContent.widthAnchor),
            preferredWidth,
        ])
        showLoading()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Match the existing 560×525 composition on the 2732² aspectFill
        // LaunchScreen image; keep the mark's size through the OS/native handoff.
        let width = max(bounds.width, bounds.height) * 560 / 2732
        let height = width * 525 / 560
        logo.frame = CGRect(x: (bounds.width - width) / 2, y: (bounds.height - height) / 2,
                            width: width, height: height)
        for (index, dot) in dots.enumerated() {
            dot.frame = CGRect(x: bounds.midX - 17 + CGFloat(index) * 14,
                               y: logo.frame.maxY + 26, width: 6, height: 6)
        }
    }

    func showLoading() {
        layer.removeAllAnimations()
        isHidden = false
        alpha = 1
        logo.isHidden = false
        dots.forEach { $0.isHidden = false }
        failureScroll.isHidden = true
        isAccessibilityElement = true
        accessibilityLabel = BazaarStartupCopy.loading
        accessibilityValue = nil
        accessibilityViewIsModal = true
    }

    func setProgress(_ progress: Double) {
        accessibilityValue = "\(Int(max(0, min(1, progress)) * 100))%"
    }

    func showFailure(canRetry: Bool) {
        setAnimating(false)
        logo.isHidden = true
        dots.forEach { $0.isHidden = true }
        failureMessage.text = canRetry ? BazaarStartupCopy.failureMessage : BazaarStartupCopy.configurationMessage
        retryButton.isHidden = !canRetry
        failureScroll.isHidden = false
        isAccessibilityElement = false
        accessibilityValue = nil
        UIAccessibility.post(notification: .screenChanged, argument: failureTitle)
    }

    func setAnimating(_ enabled: Bool) {
        logo.layer.removeAnimation(forKey: "startup.pulse")
        dots.forEach { $0.layer.removeAnimation(forKey: "startup.dot") }
        guard enabled, !UIAccessibility.isReduceMotionEnabled else { return }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 1
        pulse.toValue = 0.82
        pulse.duration = 1.05
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        logo.layer.add(pulse, forKey: "startup.pulse")
        for (index, dot) in dots.enumerated() {
            let animation = CABasicAnimation(keyPath: "opacity")
            animation.fromValue = 0.25
            animation.toValue = 1
            animation.duration = 0.65
            animation.autoreverses = true
            animation.repeatCount = .infinity
            animation.beginTime = CACurrentMediaTime() + Double(index) * 0.16
            animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            dot.layer.add(animation, forKey: "startup.dot")
        }
    }

    @objc private func retryTapped() { retry?() }
}

@MainActor
private final class BazaarStartupCoordinator {
    private enum State: Equatable { case loading, failed, ready }
    private weak var webView: WKWebView?
    private weak var parent: UIView?
    private let origin: BazaarBillingOrigin?
    private let launchURL: URL?
    private let cover: BazaarStartupCover
    private let stateDidChange: () -> Void
    private var observations: [NSKeyValueObservation] = []
    private var notifications: [NSObjectProtocol] = []
    private var timer: Timer?
    private var state: State = .loading
    private var generation = 0
    private var checkingDocument = false
    private var activeSince: CFTimeInterval?
    private var remainingActiveTime: CFTimeInterval = 20

    var coversWebContent: Bool { state != .ready }

    // Evaluate only in WKWebView's top-level page world. No message handler,
    // callable native API, URL, token or bridge permission is added for readiness.
    private static let readinessScript = #"""
    (() => {
      if (window.top !== window || document.readyState === 'loading') return false;
      const visible = Array.from(document.querySelectorAll('main, [role="main"], form')).some(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && style.opacity !== '0' &&
          (node.textContent.trim().length > 0 || node.querySelector('input,button'));
      });
      if (!visible) return false;
      if (document.documentElement.dataset.nativeRuntime === 'capacitor') return true;
      // A trusted plain support/error document may intentionally have no React
      // runtime. Never confuse SSR markup with hydration of a Next.js login.
      return document.readyState === 'complete' && !document.querySelector('script[src*="/_next/"]');
    })()
    """#

    init(webView: WKWebView, parent: UIView, origin: BazaarBillingOrigin?, launchURL: URL?,
         stateDidChange: @escaping () -> Void) {
        self.webView = webView
        self.parent = parent
        self.origin = origin
        self.launchURL = launchURL
        self.stateDidChange = stateDidChange
        cover = BazaarStartupCover(frame: parent.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        parent.addSubview(cover)
        cover.retry = { [weak self] in self?.retry() }
        observations = [
            webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.loadingChanged() }
            },
            webView.observe(\.url, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.tick() }
            },
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.tick() }
            },
        ]
        let center = NotificationCenter.default
        notifications = [
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.pause() }
            },
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.resume() }
            },
            center.addObserver(forName: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.cover.setAnimating(self.state == .loading && self.activeSince != nil)
                }
            },
        ]
        begin()
    }

    deinit {
        timer?.invalidate()
        notifications.forEach(NotificationCenter.default.removeObserver)
    }

    private func begin() {
        generation += 1
        checkingDocument = false
        state = .loading
        remainingActiveTime = 20
        activeSince = nil
        cover.showLoading()
        parent?.bringSubviewToFront(cover)
        stateDidChange()
        guard origin != nil, launchURL != nil else { fail(); return }
        resume()
    }

    private func loadingChanged() {
        if state == .ready, webView?.isLoading == true { begin() }
        tick()
    }

    private func pause() {
        if let activeSince { remainingActiveTime -= CACurrentMediaTime() - activeSince }
        activeSince = nil
        timer?.invalidate()
        timer = nil
        cover.setAnimating(false)
    }

    private func resume() {
        guard state == .loading, activeSince == nil,
              UIApplication.shared.applicationState != .background else { return }
        activeSince = CACurrentMediaTime()
        cover.setAnimating(true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        tick()
    }

    private func tick() {
        guard state == .loading, let activeSince, let webView, let origin else { return }
        if CACurrentMediaTime() - activeSince >= remainingActiveTime { fail(); return }
        cover.setProgress(webView.estimatedProgress)
        guard let documentURL = webView.url else { return }
        guard origin.matches(documentURL) else { fail(); return }
        guard !checkingDocument else { return }
        checkingDocument = true
        let checkGeneration = generation
        webView.evaluateJavaScript(Self.readinessScript, in: nil, in: .page) { [weak self] result in
            guard let self, self.generation == checkGeneration else { return }
            self.checkingDocument = false
            guard self.state == .loading, let webView = self.webView,
                  webView.url == documentURL, origin.matches(webView.url) else { return }
            if case .success(let ready as Bool) = result, ready { self.finish() }
        }
    }

    private func fail() {
        guard state != .failed else { return }
        state = .failed
        generation += 1
        pause()
        cover.showFailure(canRetry: launchURL != nil)
        stateDidChange()
    }

    private func finish() {
        state = .ready
        generation += 1
        pause()
        cover.accessibilityViewIsModal = false
        stateDidChange()
        if UIAccessibility.isReduceMotionEnabled {
            cover.isHidden = true
        } else {
            UIView.animate(withDuration: 0.18, animations: { self.cover.alpha = 0 }) { [weak self] _ in
                guard let self, self.state == .ready else { return }
                self.cover.isHidden = true
            }
        }
    }

    private func retry() {
        guard let webView, let launchURL, origin?.matches(launchURL) == true else { return }
        webView.stopLoading()
        begin()
        webView.load(URLRequest(url: launchURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }
}
