import AppKit
import Carbon.HIToolbox

// Global shortcut: Option+Z (⌥Z) — matches the Electron prototype.
// Registered via Carbon's RegisterEventHotKey, which does NOT require
// Accessibility permission (unlike NSEvent.addGlobalMonitorForEvents, which
// taps every global keystroke). This only fires for the exact registered
// combo.
private let hotKeyKeyCode: UInt32 = UInt32(kVK_ANSI_Z)
private let hotKeyModifiers: UInt32 = UInt32(optionKey)
private let hotKeySignature: OSType = 0x4c_49_4b_48 // "LIKH"
private let hotKeyID: UInt32 = 1

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private let popup = ResultPopup()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar/background app, no Dock icon

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.title = "Likho"
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Run zbill (⌥Z)", action: #selector(triggerCapture), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Likho", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = menu
        statusItem = item

        registerGlobalHotKey()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
        }
        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
        }
    }

    private func registerGlobalHotKey() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_, event, userData) -> OSStatus in
                guard let userData else { return noErr }
                let appDelegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
                appDelegate.triggerCapture()
                return noErr
            },
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandlerRef
        )

        let id = EventHotKeyID(signature: hotKeySignature, id: hotKeyID)
        let status = RegisterEventHotKey(hotKeyKeyCode, hotKeyModifiers, id, GetApplicationEventTarget(), 0, &hotKeyRef)
        if status != noErr {
            print("Failed to register global hotkey (status \(status))")
        }
    }

    @objc private func triggerCapture() {
        let mouseLocation = NSEvent.mouseLocation

        guard let text = ClipboardCapture.currentText(), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            let response = LikhoCliResponse(ok: false, parsed: nil, bill: nil, error: "Clipboard is empty. Copy the order text first, then press ⌥Z.")
            popup.show(near: mouseLocation, response: response)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let response = try LikhoBridge.parseOrder(text)
                DispatchQueue.main.async {
                    self.popup.show(near: mouseLocation, response: response)
                }
            } catch {
                let response = LikhoCliResponse(ok: false, parsed: nil, bill: nil, error: error.localizedDescription)
                DispatchQueue.main.async {
                    self.popup.show(near: mouseLocation, response: response)
                }
            }
        }
    }
}
