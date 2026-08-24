import AppKit

// Global shortcut: Cmd+Shift+L. Changeable below.
private let hotKeyKeyCode: UInt16 = 0x25 // kVK_ANSI_L
private let hotKeyModifiers: NSEvent.ModifierFlags = [.command, .shift]

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var globalMonitor: Any?
    private let popup = ResultPopup()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar/background app, no Dock icon

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.title = "Likho"
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Capture Selection (⌘⇧L)", action: #selector(triggerCapture), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Likho", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = menu
        statusItem = item

        registerGlobalHotKey()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
    }

    private func registerGlobalHotKey() {
        // Requires Accessibility (or Input Monitoring) permission granted to
        // this binary in System Settings > Privacy & Security.
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == hotKeyKeyCode else { return }
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == hotKeyModifiers else { return }
            self?.triggerCapture()
        }
    }

    @objc private func triggerCapture() {
        let mouseLocation = NSEvent.mouseLocation

        ClipboardCapture.captureSelectedText { [weak self] text in
            guard let self else { return }
            guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                let response = LikhoCliResponse(ok: false, parsed: nil, error: "No text selected.")
                self.popup.show(near: mouseLocation, response: response)
                return
            }

            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let response = try LikhoBridge.parseOrder(text)
                    DispatchQueue.main.async {
                        self.popup.show(near: mouseLocation, response: response)
                    }
                } catch {
                    let response = LikhoCliResponse(ok: false, parsed: nil, error: error.localizedDescription)
                    DispatchQueue.main.async {
                        self.popup.show(near: mouseLocation, response: response)
                    }
                }
            }
        }
    }
}
