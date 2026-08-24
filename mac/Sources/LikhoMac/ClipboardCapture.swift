import AppKit
import CoreGraphics

// Simplest reliable V1 approach for reading "the currently selected text in
// whatever app is frontmost": simulate Cmd+C, read the pasteboard, restore
// whatever was on the pasteboard before. Requires Accessibility (or Input
// Monitoring) permission to be granted to this app for the synthetic
// keystroke to reach other apps.
enum ClipboardCapture {
    /// Returns the currently selected text (best effort) by simulating
    /// Cmd+C and reading the pasteboard, then restores the pasteboard's
    /// prior contents.
    static func captureSelectedText(completion: @escaping (String?) -> Void) {
        let pasteboard = NSPasteboard.general
        let previousContents = pasteboard.string(forType: .string)
        let previousChangeCount = pasteboard.changeCount

        simulateCommandC()

        // Give the frontmost app a moment to write the selection to the
        // pasteboard before we read it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            let changed = pasteboard.changeCount != previousChangeCount
            let captured = changed ? pasteboard.string(forType: .string) : nil

            // Restore whatever was on the clipboard before we intervened.
            if let previousContents {
                pasteboard.clearContents()
                pasteboard.setString(previousContents, forType: .string)
            }

            completion(captured)
        }
    }

    private static func simulateCommandC() {
        let source = CGEventSource(stateID: .hidSystemState)
        let keyCodeC: CGKeyCode = 0x08 // kVK_ANSI_C

        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCodeC, keyDown: true)
        keyDown?.flags = .maskCommand
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCodeC, keyDown: false)
        keyUp?.flags = .maskCommand

        keyDown?.post(tap: .cghidEventTap)
        keyUp?.post(tap: .cghidEventTap)
    }
}
