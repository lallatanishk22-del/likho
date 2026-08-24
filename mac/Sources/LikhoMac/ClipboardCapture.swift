import AppKit

// V1 approach (no simulated keystrokes, no Accessibility permission
// required): the user copies the order text themselves (⌘C) before
// triggering Likho; this just reads whatever is currently on the
// pasteboard. Simpler and more reliable than simulating ⌘C, and matches
// the same clipboard-only flow validated in the Electron prototype.
enum ClipboardCapture {
    static func currentText() -> String? {
        NSPasteboard.general.string(forType: .string)
    }
}
