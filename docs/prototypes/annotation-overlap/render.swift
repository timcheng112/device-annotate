// Neutral layout proposal, not the production renderer.
import AppKit

let width = 1440
let height = 710
let canvas = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: canvas)
let context = NSGraphicsContext.current!.cgContext
context.translateBy(x: 0, y: CGFloat(height))
context.scaleBy(x: 1, y: -1)
let green = NSColor(calibratedRed: 0.04, green: 0.45, blue: 0.29, alpha: 1)
let ink = NSColor(calibratedWhite: 0.12, alpha: 1)
let muted = NSColor(calibratedWhite: 0.40, alpha: 1)

func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: NSColor) {
    color.setFill()
    NSBezierPath(rect: NSRect(x: x, y: y, width: w, height: h)).fill()
}
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 18, _ color: NSColor = ink, bold: Bool = false) {
    let style: [NSAttributedString.Key: Any] = [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: color]
    let string = NSAttributedString(string: value, attributes: style)
    context.saveGState()
    context.translateBy(x: x, y: y + string.size().height)
    context.scaleBy(x: 1, y: -1)
    string.draw(at: .zero)
    context.restoreGState()
}
func outline(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, dashed: Bool = false) {
    let path = NSBezierPath(rect: NSRect(x: x, y: y, width: w, height: h))
    NSColor.white.setStroke()
    path.lineWidth = 8
    path.stroke()
    green.setStroke()
    path.lineWidth = 3
    if dashed { path.setLineDash([8, 5], count: 2, phase: 0) }
    path.stroke()
}
func badge(_ n: String, _ x: CGFloat, _ y: CGFloat) {
    let circle = NSBezierPath(ovalIn: NSRect(x: x - 17, y: y - 17, width: 34, height: 34))
    NSColor.white.setStroke()
    circle.lineWidth = 6
    circle.stroke()
    green.setFill()
    circle.fill()
    text(n, x - 6, y - 12, 19, .white, bold: true)
}
func row(_ n: String, _ x: CGFloat, _ y: CGFloat, _ title: String, _ detail: String) {
    badge(n, x + 18, y + 18)
    text(title, x + 48, y, 17, ink, bold: true)
    text(detail, x + 48, y + 26, 15, muted)
}

rect(0, 0, CGFloat(width), CGFloat(height), NSColor(calibratedWhite: 0.95, alpha: 1))
text("Same result, distinct annotation identities", 30, 24, 30, ink, bold: true)
text("Layout proposal only • Green = passed. Numbers = identity. Synthetic UI, no app captures.", 30, 67, 18, muted)

let titles = ["1. Nearby targets", "2. Overlapping bounds", "3. Identical bounds"]
let captions = ["Place badges on opposite outer edges.", "Use distinct badges and outline patterns.", "One outline, two separately numbered checks."]
for i in 0..<3 {
    let x = CGFloat(30 + i * 470)
    rect(x, 118, 440, 557, .white)
    text(titles[i], x + 20, 136, 22, ink, bold: true)
    rect(x + 20, 184, 400, 266, NSColor(calibratedWhite: 0.94, alpha: 1))
    text("DEMO STORE", x + 40, 203, 13, muted, bold: true)
    if i == 0 {
        rect(x + 65, 282, 150, 64, NSColor(calibratedWhite: 0.85, alpha: 1))
        rect(x + 225, 282, 150, 64, NSColor(calibratedWhite: 0.85, alpha: 1))
        text("Save", x + 112, 302, 18)
        text("Continue", x + 259, 302, 18)
        outline(x + 65, 282, 150, 64)
        outline(x + 225, 282, 150, 64)
        badge("1", x + 65, 282)
        badge("2", x + 375, 346)
        row("1", x + 20, 510, "PASS · Save button", "Expected visible; actual visible")
        row("2", x + 20, 578, "PASS · Continue button", "Expected visible; actual visible")
    } else if i == 1 {
        rect(x + 65, 260, 310, 134, NSColor(calibratedWhite: 0.87, alpha: 1))
        text("Order summary", x + 90, 276, 18)
        rect(x + 205, 330, 170, 64, NSColor(calibratedWhite: 0.79, alpha: 1))
        text("Pay $12.00", x + 235, 349, 18)
        outline(x + 65, 260, 310, 134)
        outline(x + 205, 330, 170, 64, dashed: true)
        badge("1", x + 65, 260)
        badge("2", x + 375, 330)
        row("1", x + 20, 510, "PASS · Summary panel · solid", "Expected visible; actual visible")
        row("2", x + 20, 578, "PASS · Pay button · dashed", "Expected $12.00; actual $12.00")
    } else {
        rect(x + 85, 282, 270, 76, NSColor(calibratedWhite: 0.85, alpha: 1))
        text("Continue", x + 180, 307, 20)
        outline(x + 85, 282, 270, 76)
        badge("1", x + 85, 282)
        badge("2", x + 355, 358)
        row("1", x + 20, 510, "PASS · Continue · visibility", "Expected visible; actual visible")
        row("2", x + 20, 578, "PASS · Same button · text", "Expected Continue; actual Continue")
    }
    text(captions[i], x + 20, 468, 16, muted)
}
NSGraphicsContext.restoreGraphicsState()
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "proposal.png"
try canvas.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
let directory = URL(fileURLWithPath: output).deletingLastPathComponent()
for (i, name) in ["nearby", "overlapping", "identical"].enumerated() {
    let panel = canvas.cgImage!.cropping(to: CGRect(x: 20 + i * 470, y: 108, width: 460, height: 577))!
    let bitmap = NSBitmapImageRep(cgImage: panel)
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("\(name).png"))
}
