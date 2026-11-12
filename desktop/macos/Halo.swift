import AppKit
import WebKit
import UniformTypeIdentifiers

struct LocalConfiguration: Decodable {
    let projectRoot: String
    let nodeExecutable: String
}

final class WindowDragRegion: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { window?.performZoom(nil) }
        else { window?.performDrag(with: event) }
    }
}

@MainActor
final class HaloApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var process: Process?
    private var startup: Task<Void, Never>?
    private var configuration: LocalConfiguration!
    private var terminating = false
    private let smoke = CommandLine.arguments.contains("--smoke-test")
    private let smokeDownload = CommandLine.arguments.contains("--smoke-screenshot-download")
    private var smokeDownloadFinished = false
    private let launchedAt = ProcessInfo.processInfo.systemUptime
    private var startupMarks: [String: Double] = [:]
    private var recordedReady = false
    private let localURL = URL(string: "http://127.0.0.1:8765")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let url = Bundle.main.url(forResource: "local-configuration", withExtension: "json")!
            configuration = try JSONDecoder().decode(LocalConfiguration.self, from: Data(contentsOf: url))
        } catch { fail("Cannot read the local Halo configuration. Rebuild the Mac app."); return }
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Halo", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Halo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let item = NSMenuItem(); item.submenu = appMenu; menu.addItem(item)
        let edit = NSMenu()
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: ""); editItem.submenu = edit; menu.addItem(editItem)
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Halo"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.minSize = NSSize(width: 820, height: 560)
        window.center()
        window.isReleasedWhenClosed = false
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('halo-macos')", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        // Keep native window dragging outside WebKit's flipped view hierarchy.
        // A matching Mac-only inset keeps all web controls below this strip.
        let contentHost = NSView(frame: window.contentView!.bounds)
        window.contentView = contentHost
        let dragRegion = WindowDragRegion(frame: .zero)
        webView.translatesAutoresizingMaskIntoConstraints = false
        dragRegion.translatesAutoresizingMaskIntoConstraints = false
        contentHost.addSubview(webView)
        contentHost.addSubview(dragRegion)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentHost.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentHost.bottomAnchor),
            dragRegion.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
            dragRegion.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
            dragRegion.topAnchor.constraint(equalTo: contentHost.topAnchor),
            dragRegion.heightAnchor.constraint(equalToConstant: 32),
        ])
        webView.loadHTMLString("<html><body style='margin:0;height:100vh;display:grid;place-items:center;background:#090909;color:#FBFBFA;font:15px -apple-system'><div>Starting Halo…<p style='color:#888;font-size:12px'>Preparing your local workspace.</p></div></body></html>", baseURL: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        markStartup("windowShownMs")
        startup = Task { await connect() }
    }

    private func markStartup(_ name: String) {
        startupMarks[name] = (ProcessInfo.processInfo.systemUptime - launchedAt) * 1000
        let directory = configuration.projectRoot + "/logs"
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: startupMarks, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: directory + "/startup-native.json"), options: .atomic)
        }
    }

    private func probe() async -> Bool {
        do {
            var request = URLRequest(url: localURL.appendingPathComponent("api/session"))
            request.timeoutInterval = 1
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = value["token"] as? String,
                  let stored = try? String(contentsOfFile: configuration.projectRoot + "/.cache/halo/session-token", encoding: .utf8) else { return false }
            return token == stored.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch { return false }
    }

    private func connect() async {
        if await probe() { markStartup("serviceReadyMs"); webView.load(URLRequest(url: localURL)); return }
        do {
            let child = Process()
            child.executableURL = URL(fileURLWithPath: configuration.nodeExecutable)
            child.currentDirectoryURL = URL(fileURLWithPath: configuration.projectRoot + "/runtime")
            child.arguments = ["--import", "tsx", "src/launcher.ts"]
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = URL(fileURLWithPath: configuration.nodeExecutable).deletingLastPathComponent().path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            child.environment = environment
            let logs = configuration.projectRoot + "/logs"
            try FileManager.default.createDirectory(atPath: logs, withIntermediateDirectories: true)
            let logfile = logs + "/macos-app.log"
            FileManager.default.createFile(atPath: logfile, contents: nil)
            let output = try FileHandle(forWritingTo: URL(fileURLWithPath: logfile))
            child.standardOutput = output
            child.standardError = output
            try child.run()
            process = child
            for _ in 0..<1200 {
                if Task.isCancelled { return }
                if await probe() { markStartup("serviceReadyMs"); webView.load(URLRequest(url: localURL)); return }
                if !child.isRunning { fail("Halo could not start. Read logs/macos-app.log in the project. If another Halo or Convex process is running, stop that process and reopen the app."); return }
                try await Task.sleep(for: .milliseconds(100))
            }
            fail("The local workspace did not become ready. Read logs/macos-app.log.")
        } catch { fail("Cannot start the Halo runtime. Run bash scripts/poc.sh setup in the project, then reopen this app.") }
    }

    private func fail(_ message: String) {
        if smoke { fputs("Halo smoke failure: \(message)\n", stderr); NSApp.terminate(nil); return }
        let alert = NSAlert(); alert.messageText = "Halo needs attention"; alert.informativeText = message
        alert.addButton(withTitle: "Quit"); alert.runModal(); NSApp.terminate(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload && url.absoluteString.hasPrefix("blob:http://127.0.0.1:8765/") {
            decisionHandler(.download); return
        }
        if url.absoluteString == "about:blank" || (url.scheme == "http" && url.host == "127.0.0.1" && url.port == 8765) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard response.mimeType == "image/png" else { completionHandler(nil); return }
        if smoke && smokeDownload {
            let destination = URL(fileURLWithPath: configuration.projectRoot + "/artifacts/macos-screenshot-download.png")
            try? FileManager.default.removeItem(at: destination)
            completionHandler(destination); return
        }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) { smokeDownloadFinished = true }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !recordedReady, webView.url?.host == "127.0.0.1" else { return }
        Task {
            for _ in 0..<200 {
                let ready = try? await webView.evaluateJavaScript("!!document.querySelector('#message') && !!document.querySelector('.sidebar')")
                if ready as? Bool == true {
                    recordedReady = true
                    markStartup("interactiveMs")
                    guard smoke else { return }
                    window.contentView?.layoutSubtreeIfNeeded()
                    guard let host = window.contentView,
                          host.hitTest(NSPoint(x: host.bounds.midX, y: host.bounds.maxY - 16)) is WindowDragRegion,
                          !(host.hitTest(NSPoint(x: host.bounds.midX, y: host.bounds.maxY - 64)) is WindowDragRegion),
                          (try? await webView.evaluateJavaScript("document.documentElement.classList.contains('halo-macos') && document.querySelector('main .panels').getBoundingClientRect().top >= 32")) as? Bool == true else {
                        fail("The window drag area overlaps the workspace or is not reachable."); return
                    }
                    print("PASS: full-width native drag area receives hits above the inset workspace.")
                    if let image = try? await webView.takeSnapshot(configuration: nil), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: configuration.projectRoot + "/artifacts/halo-macos.png"))
                    }
                    print("PASS: native Mac window loaded the React/Convex workspace in WKWebView.")
                    if smokeDownload {
                        _ = try? await webView.evaluateJavaScript("(() => { const c = document.createElement('canvas'); c.width = 2; c.height = 2; c.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'halo-smoke.png'; document.body.appendChild(a); a.click(); a.remove(); }, 'image/png'); return true; })()")
                        for _ in 0..<50 {
                            if smokeDownloadFinished { break }
                            try? await Task.sleep(for: .milliseconds(100))
                        }
                        guard smokeDownloadFinished,
                              let data = try? Data(contentsOf: URL(fileURLWithPath: configuration.projectRoot + "/artifacts/macos-screenshot-download.png")),
                              data.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10]) else {
                            fail("The native screenshot download did not complete."); return
                        }
                        print("PASS: native WKWebView saved a PNG through its download delegate.")
                    }
                    NSApp.terminate(nil); return
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
            if smoke { fail("The Mac webview did not load the workspace.") }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        startup?.cancel()
        guard let child = process, child.isRunning else { return .terminateNow }
        if terminating { return .terminateLater }
        terminating = true
        window.title = "Halo · Stopping local services…"
        child.terminate()
        // AppKit suspends MainActor tasks after terminateLater. Foundation's
        // waitUntilExit pumps the run loop while the Node launcher performs its
        // bounded cleanup. Do not schedule a Task that can never reply.
        child.waitUntilExit()
        return .terminateNow
    }
}

@main
struct Main {
    @MainActor static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        let delegate = HaloApp()
        application.delegate = delegate
        application.run()
    }
}
