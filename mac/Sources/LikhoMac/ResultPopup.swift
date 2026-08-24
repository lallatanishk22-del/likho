import AppKit

// Small Spotlight/Raycast-style borderless floating panel that displays
// whatever routeParseOrder() returned. Pure display — no parsing, no
// pricing math (that stays in calculator.ts / formatter.ts, untouched).
final class ResultPopup {
    private var panel: NSPanel?

    func show(near point: NSPoint, response: LikhoCliResponse) {
        let text = Self.render(response)

        let width: CGFloat = 380
        let textView = NSTextView(frame: NSRect(x: 12, y: 12, width: width - 24, height: 0))
        textView.string = text
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textContainerInset = NSSize(width: 4, height: 4)
        textView.sizeToFit()

        let contentHeight = max(60, textView.frame.height + 24)
        let frame = NSRect(x: point.x, y: point.y - contentHeight, width: width, height: contentHeight)

        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hasShadow = true
        panel.backgroundColor = NSColor.windowBackgroundColor
        panel.isMovableByWindowBackground = true
        panel.contentView?.wantsLayer = true
        panel.contentView?.layer?.cornerRadius = 10
        panel.contentView?.layer?.masksToBounds = true

        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: width, height: contentHeight))
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .noBorder
        panel.contentView = scrollView

        panel.orderFrontRegardless()
        self.panel = panel

        // Dismiss on click-away or Escape; also auto-close after a while so
        // stale popups don't linger.
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: panel, queue: .main
        ) { [weak self] _ in
            self?.panel = nil
        }
    }

    func close() {
        panel?.close()
        panel = nil
    }

    private static func render(_ response: LikhoCliResponse) -> String {
        guard response.ok, let parsed = response.parsed else {
            return "Needs clarification:\n\n\(response.error ?? "Unknown error")"
        }

        var lines: [String] = []
        if let customer = parsed.customer {
            lines.append(customer.uppercased())
            lines.append("")
        }
        for item in parsed.items {
            let priceStr = String(format: "%.2f", item.unitPrice)
            lines.append("\(item.name) × \(item.quantity) — ₹\(priceStr)")
        }
        if let discount = parsed.discountPercent {
            lines.append("")
            lines.append("Discount: \(discount)%")
        }
        return lines.joined(separator: "\n")
    }
}
