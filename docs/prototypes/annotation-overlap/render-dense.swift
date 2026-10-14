// Synthetic proposal for dense overlap. Not the production layout algorithm.
import AppKit

let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1100, pixelsHigh: 1550, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let ctx = NSGraphicsContext.current!.cgContext
ctx.translateBy(x: 0, y: 1550)
ctx.scaleBy(x: 1, y: -1)
let green = NSColor(calibratedRed: 0.04, green: 0.45, blue: 0.29, alpha: 1)
let ink = NSColor(calibratedWhite: 0.13, alpha: 1)
let gray = NSColor(calibratedWhite: 0.43, alpha: 1)
func fill(_ r: CGRect, _ c: NSColor) { c.setFill(); NSBezierPath(rect: r).fill() }
func text(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 18, _ c: NSColor = ink, _ bold: Bool = false) {
    let a = NSAttributedString(string: s, attributes: [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: c])
    ctx.saveGState(); ctx.translateBy(x: x, y: y + a.size().height); ctx.scaleBy(x: 1, y: -1)
    a.draw(at: .zero); ctx.restoreGState()
}
func outline(_ r: CGRect) {
    let p = NSBezierPath(rect: r)
    NSColor.white.setStroke(); p.lineWidth = 7; p.stroke()
    green.setStroke(); p.lineWidth = 3; p.stroke()
}
func badge(_ n: Int, _ x: CGFloat, _ y: CGFloat) {
    let p = NSBezierPath(ovalIn: CGRect(x: x-16, y: y-16, width: 32, height: 32))
    NSColor.white.setStroke(); p.lineWidth = 5; p.stroke()
    green.setFill(); p.fill(); text(String(n), x-5.5, y-11, 18, .white, true)
}
let targets: [CGRect] = [
    CGRect(x: 50, y: 30, width: 600, height: 280),
    CGRect(x: 70, y: 115, width: 560, height: 170),
    CGRect(x: 90, y: 210, width: 520, height: 60),
    CGRect(x: 390, y: 218, width: 200, height: 44),
    CGRect(x: 415, y: 224, width: 150, height: 32)
]
let names = ["Order card", "Price summary", "Total row", "Amount group", "Amount label"]
func screen() {
    fill(CGRect(x: 0, y: 0, width: 700, height: 350), NSColor(calibratedWhite: 0.94, alpha: 1))
    fill(targets[0], .white)
    text("Order summary", 80, 58, 24, ink, true)
    text("Subtotal", 95, 140); text("$10.00", 470, 140)
    text("Delivery", 95, 177); text("$2.00", 482, 177)
    fill(targets[2], NSColor(calibratedWhite: 0.90, alpha: 1))
    text("Total", 110, 229, 20, ink, true)
    text("$12.00", 445, 229, 20, ink, true)
}
fill(CGRect(x: 0, y: 0, width: 1100, height: 1550), NSColor(calibratedWhite: 0.96, alpha: 1))
text("Five overlapping targets: proposed fallback", 30, 22, 30, ink, true)
text("PASS · Criterion: the order summary and $12.00 total are visible", 30, 66, 20, green, true)
text("Synthetic UI. All five rectangles contain the amount label. One evidence image.", 30, 100, 18, gray)
text("Overview: numbers preserve identity, but dense outlines are still hard to read", 30, 145, 20, ink, true)
ctx.saveGState(); ctx.translateBy(x: 30, y: 190); screen()
for r in targets { outline(r) }
ctx.restoreGState()
for (i, r) in targets.enumerated() {
    let y = CGFloat(222 + i * 64)
    let p = NSBezierPath()
    p.move(to: CGPoint(x: r.maxX + 30, y: r.minY + 190))
    p.line(to: CGPoint(x: 760, y: y))
    p.line(to: CGPoint(x: 790, y: y))
    NSColor.white.setStroke(); p.lineWidth = 6; p.stroke()
    green.setStroke(); p.lineWidth = 2; p.stroke()
    badge(i+1, 808, y); text(names[i], 835, y-12, 20, ink, true)
}
text("Detail views: one highlighted target per view, with its matching check", 30, 568, 22, ink, true)
for (i, target) in targets.enumerated() {
    let x = CGFloat(30 + (i % 2) * 535)
    let y = CGFloat(615 + (i / 2) * 300)
    fill(CGRect(x: x, y: y, width: 505, height: 280), .white)
    badge(i+1, x+27, y+29)
    text("PASS · " + names[i], x+54, y+16, 20, ink, true)
    let crop = target.insetBy(dx: -22, dy: -22).intersection(CGRect(x: 0, y: 0, width: 700, height: 350))
    let scale = min(465 / crop.width, 175 / crop.height)
    let viewX = x+20+(465-crop.width*scale)/2
    let viewY = y+61+(175-crop.height*scale)/2
    ctx.saveGState()
    ctx.clip(to: CGRect(x: viewX, y: viewY, width: crop.width*scale, height: crop.height*scale))
    ctx.translateBy(x: viewX-crop.minX*scale, y: viewY-crop.minY*scale)
    ctx.scaleBy(x: scale, y: scale)
    screen(); outline(target)
    ctx.restoreGState()
    text(i == 4 ? "Expected text $12.00; actual $12.00" : "Expected visible; actual visible", x+20, y+247, 17, gray)
}
text("Proposal awaiting review", 565, 1250, 23, ink, true)
text("Separate views remove outline ambiguity.", 565, 1293, 18, gray)
text("They make the evidence image taller.", 565, 1325, 18, gray)
text("Every view uses the same captured frame.", 565, 1357, 18, gray)
NSGraphicsContext.restoreGraphicsState()
let output = CommandLine.arguments[1]
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
