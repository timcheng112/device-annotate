// Synthetic color-semantics proposal; not the production renderer.
import AppKit
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1120, pixelsHigh: 1120, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let ctx = NSGraphicsContext.current!.cgContext
ctx.translateBy(x: 0, y: 1120); ctx.scaleBy(x: 1, y: -1)
let ink = NSColor(calibratedWhite: 0.13, alpha: 1)
let gray = NSColor(calibratedWhite: 0.4, alpha: 1)
let blue = NSColor(calibratedRed: 0.12, green: 0.32, blue: 0.72, alpha: 1)
let orange = NSColor(calibratedRed: 0.65, green: 0.28, blue: 0.02, alpha: 1)
let purple = NSColor(calibratedRed: 0.48, green: 0.20, blue: 0.66, alpha: 1)
let pass = NSColor(calibratedRed: 0.04, green: 0.45, blue: 0.29, alpha: 1)
let fail = NSColor(calibratedRed: 0.70, green: 0.12, blue: 0.10, alpha: 1)
func fill(_ r: CGRect, _ c: NSColor) { c.setFill(); NSBezierPath(rect: r).fill() }
func text(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 18, _ c: NSColor = ink, _ bold: Bool = false) {
    let a = NSAttributedString(string: s, attributes: [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: c])
    ctx.saveGState(); ctx.translateBy(x: x, y: y+a.size().height); ctx.scaleBy(x: 1, y: -1)
    a.draw(at: .zero); ctx.restoreGState()
}
func outline(_ r: CGRect, _ c: NSColor, _ dashed: Bool = false) {
    let p = NSBezierPath(rect: r)
    NSColor.white.setStroke(); p.lineWidth = 9; p.stroke()
    if dashed { p.setLineDash([10, 6], count: 2, phase: 0) }
    c.setStroke(); p.lineWidth = 4; p.stroke()
}
func badge(_ s: String, _ x: CGFloat, _ y: CGFloat, _ c: NSColor) {
    let p = NSBezierPath(roundedRect: CGRect(x: x, y: y, width: 66, height: 34), xRadius: 17, yRadius: 17)
    NSColor.white.setStroke(); p.lineWidth = 6; p.stroke(); c.setFill(); p.fill()
    text(s, x+12, y+4, 20, .white, true)
}
func ui(_ x: CGFloat, _ y: CGFloat) {
    fill(CGRect(x: x, y: y, width: 470, height: 270), NSColor(calibratedWhite: 0.92, alpha: 1))
    fill(CGRect(x: x+40, y: y+40, width: 390, height: 185), .white)
    text("Order summary", x+60, y+63, 23, ink, true)
    text("Subtotal", x+65, y+112, 17); text("$10.00", x+325, y+112, 17)
    fill(CGRect(x: x+220, y: y+160, width: 210, height: 65), NSColor(calibratedWhite: 0.84, alpha: 1))
    text("Pay $12.00", x+260, y+180, 20, ink, true)
}
if CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "info" {
    fill(CGRect(x: 0, y: 0, width: 1120, height: 1120), NSColor(calibratedWhite: 0.96, alpha: 1))
    text("Approved: distinguish information from a checked result", 30, 24, 28, ink, true)
    text("A number without ✓ or × identifies an informational annotation. Its legend row says INFO.", 30, 70, 19)
    text("Dotted outline: no checks. Solid: checks all pass. Dashed: at least one check fails.", 30, 107, 19, gray)
    for i in 0..<2 {
        let x = CGFloat(30+i*550)
        fill(CGRect(x: x, y: 154, width: 520, height: 620), .white)
        text(i == 0 ? "Information only" : "Information and checks share bounds", x+20, 175, i == 0 ? 24 : 22, ink, true)
        fill(CGRect(x: x+25, y: 230, width: 470, height: 240), NSColor(calibratedWhite: 0.92, alpha: 1))
        let target = CGRect(x: x+95, y: 310, width: 330, height: 80)
        fill(target, NSColor(calibratedWhite: 0.84, alpha: 1))
        text("Continue", x+205, 334, 22, ink, true)
        if i == 0 {
            let p = NSBezierPath(rect: target)
            NSColor.white.setStroke(); p.lineWidth = 9; p.stroke()
            p.setLineDash([1, 9], count: 2, phase: 0); p.lineCapStyle = .round
            blue.setStroke(); p.lineWidth = 4; p.stroke()
        } else { outline(target, blue, true) }
        let label = i == 0 ? "1" : "1, 2 ✓, 3 ×"
        let measured = NSAttributedString(string: label, attributes: [.font: NSFont.boldSystemFont(ofSize: 20)]).size().width
        let pill = NSBezierPath(roundedRect: CGRect(x: x+75, y: 288, width: measured+28, height: 40), xRadius: 20, yRadius: 20)
        NSColor.white.setStroke(); pill.lineWidth = 6; pill.stroke(); blue.setFill(); pill.fill()
        text(label, x+89, 295, 20, .white, true)
        text("1   INFO · Continue button", x+25, 505, 21, blue, true)
        text("Highlighted for context; no assertion", x+25, 540, 17, gray)
        if i == 1 {
            text("2   ✓ PASS · Button is visible", x+25, 580, 21, blue, true)
            text("Expected visible; actual visible", x+25, 615, 17, gray)
            text("3   × FAIL · Button text", x+25, 655, 21, blue, true)
            text("Expected Pay now; actual Continue", x+25, 690, 17, gray)
        } else {
            text("No test has passed or failed here.", x+25, 610, 20, ink, true)
            text("The target was found and highlighted.", x+25, 650, 18, gray)
        }
    }
    text("Individual results remain explicit even when informational and checked annotations share a tag.", 30, 811, 19)
    NSGraphicsContext.restoreGraphicsState()
    let panel = NSBitmapImageRep(cgImage: bitmap.cgImage!.cropping(to: CGRect(x: 0, y: 0, width: 1120, height: 870))!)
    try panel.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    exit(0)
}
if CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "grouped" {
    fill(CGRect(x: 0, y: 0, width: 1120, height: 1120), NSColor(calibratedWhite: 0.96, alpha: 1))
    text("One shared tag, an individual result for every check", 30, 24, 29, ink, true)
    text("Numbers identify checks. Each ✓ or × applies only to the number immediately before it.", 30, 70, 20)
    text("Approved treatment. Shared color and outline; separate results and legend entries.", 30, 107, 18, gray)
    for i in 0..<2 {
        let x = CGFloat(30+i*550)
        fill(CGRect(x: x, y: 154, width: 520, height: 700), .white)
        text(i == 0 ? "Both checks pass" : "Three pass, one fails", x+20, 175, 24, ink, true)
        fill(CGRect(x: x+25, y: 230, width: 470, height: 240), NSColor(calibratedWhite: 0.92, alpha: 1))
        let target = CGRect(x: x+95, y: 310, width: 330, height: 80)
        fill(target, NSColor(calibratedWhite: 0.84, alpha: 1))
        text("Continue", x+205, 334, 22, ink, true)
        outline(target, blue, i == 1)
        let label = i == 0 ? "1 ✓, 2 ✓" : "1 ✓, 2 ×, 5 ✓, 9 ✓"
        let measured = NSAttributedString(string: label, attributes: [.font: NSFont.boldSystemFont(ofSize: 20)]).size().width
        let pill = NSBezierPath(roundedRect: CGRect(x: x+75, y: 288, width: measured+28, height: 40), xRadius: 20, yRadius: 20)
        NSColor.white.setStroke(); pill.lineWidth = 6; pill.stroke(); blue.setFill(); pill.fill()
        text(label, x+89, 295, 20, .white, true)
        text("1   ✓ PASS · Button is visible", x+25, 505, 21, blue, true)
        text("Expected visible; actual visible", x+25, 540, 17, gray)
        text(i == 0 ? "2   ✓ PASS · Button text" : "2   × FAIL · Button text", x+25, 580, 21, blue, true)
        text(i == 0 ? "Expected Continue; actual Continue" : "Expected Pay now; actual Continue", x+25, 615, 17, gray)
        if i == 1 {
            text("5   ✓ PASS · Button exists", x+25, 655, 21, blue, true)
            text("Expected exists; actual exists", x+25, 690, 17, gray)
            text("9   ✓ PASS · Button is focused", x+25, 730, 21, blue, true)
            text("Expected focused; actual focused", x+25, 765, 17, gray)
        } else {
            text("Solid outline: all attached checks pass.", x+25, 705, 20, ink, true)
            text("One tag avoids scattered numbered badges.", x+25, 750, 17, gray)
        }
    }
    text("Dashed outline = at least one failure. The shared tag identifies exactly which check failed.", 30, 889, 21, ink, true)
    text("Long tags would wrap or move outside the target with a connector; check IDs would remain visible.", 30, 936, 18, gray)
    NSGraphicsContext.restoreGraphicsState()
    let panel = NSBitmapImageRep(cgImage: bitmap.cgImage!.cropping(to: CGRect(x: 0, y: 0, width: 1120, height: 990))!)
    try panel.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    exit(0)
}
if CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "shared" {
    fill(CGRect(x: 0, y: 0, width: 1120, height: 1120), NSColor(calibratedWhite: 0.96, alpha: 1))
    text("Identical bounds: one color, one shared outline", 30, 24, 30, ink, true)
    text("Separate numbers preserve each check. The shared border summarizes their results.", 30, 70, 20)
    text("Proposal awaiting review. Color identifies the region, not its outcome.", 30, 107, 18, gray)
    for i in 0..<2 {
        let x = CGFloat(30+i*550)
        fill(CGRect(x: x, y: 154, width: 520, height: 520), .white)
        text(i == 0 ? "Both checks pass" : "One passes, one fails", x+20, 175, 24, ink, true)
        fill(CGRect(x: x+25, y: 230, width: 470, height: 240), NSColor(calibratedWhite: 0.92, alpha: 1))
        let target = CGRect(x: x+95, y: 310, width: 330, height: 80)
        fill(target, NSColor(calibratedWhite: 0.84, alpha: 1))
        text("Continue", x+205, 334, 22, ink, true)
        outline(target, blue, i == 1)
        badge("1 ✓", x+65, 293, blue)
        badge(i == 0 ? "2 ✓" : "2 ×", x+393, 373, blue)
        text("1   ✓ PASS · Button is visible", x+25, 505, 21, blue, true)
        text("Expected visible; actual visible", x+25, 540, 17, gray)
        text(i == 0 ? "2   ✓ PASS · Button text" : "2   × FAIL · Button text", x+25, 580, 21, blue, true)
        text(i == 0 ? "Expected Continue; actual Continue" : "Expected Pay now; actual Continue", x+25, 615, 17, gray)
    }
    text("Solid shared border: all attached checks pass.", 30, 710, 22, ink, true)
    text("Dashed shared border: at least one attached check fails.", 30, 749, 22, ink, true)
    text("Only the drawing is shared. Selectors, target identities, and individual results remain separate.", 30, 795, 18, gray)
    NSGraphicsContext.restoreGraphicsState()
    let panel = NSBitmapImageRep(cgImage: bitmap.cgImage!.cropping(to: CGRect(x: 0, y: 0, width: 1120, height: 840))!)
    try panel.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    exit(0)
}
fill(CGRect(x: 0, y: 0, width: 1120, height: 1120), NSColor(calibratedWhite: 0.96, alpha: 1))
text("Alternative: color identifies the annotation", 30, 24, 31, ink, true)
text("Result is explicit: ✓ PASS + solid border, or × FAIL + dashed border.", 30, 70, 21)
text("Synthetic comparison. The identity-color alternative is awaiting your decision.", 30, 107, 18, gray)
for i in 0..<2 {
    let x = CGFloat(30+i*550)
    fill(CGRect(x: x, y: 154, width: 520, height: 520), .white)
    text(i == 0 ? "Current: color = result" : "Proposed: color = identity", x+20, 173, 23, ink, true)
    let sx = x+25, sy: CGFloat = 223
    ui(sx, sy)
    outline(CGRect(x: sx+40, y: sy+40, width: 390, height: 185), i == 0 ? pass : blue)
    outline(CGRect(x: sx+220, y: sy+160, width: 210, height: 65), i == 0 ? fail : orange, i == 1)
    badge(i == 0 ? "1" : "1 ✓", sx+12, sy+23, i == 0 ? pass : blue)
    badge(i == 0 ? "2" : "2 ×", sx+390, sy+143, i == 0 ? fail : orange)
    text("1   ✓ PASS · Summary is visible", x+25, 516, 21, i == 0 ? pass : blue, true)
    text("Expected visible; actual visible", x+25, 549, 17, gray)
    text("2   × FAIL · Payment amount", x+25, 589, 21, i == 0 ? fail : orange, true)
    text("Expected $10.00; actual $12.00", x+25, 622, 17, gray)
}
fill(CGRect(x: 30, y: 700, width: 1060, height: 380), .white)
text("Color alone still cannot expose identical outlines", 50, 719, 25, ink, true)
text("Two distinct targets have exactly the same rectangle. Both pass.", 50, 757, 18, gray)
fill(CGRect(x: 55, y: 811, width: 470, height: 210), NSColor(calibratedWhite: 0.92, alpha: 1))
let same = CGRect(x: 125, y: 874, width: 330, height: 80)
outline(same, blue)
outline(same, purple)
text("Continue", 244, 897, 23, ink, true)
badge("1 ✓", 95, 856, blue)
badge("2 ✓", 423, 936, purple)
text("1   ✓ PASS · Target A · blue", 565, 828, 23, blue, true)
text("2   ✓ PASS · Target B · purple", 565, 871, 23, purple, true)
text("The purple outline covers the blue outline.", 565, 925, 19)
text("Numbers retain identity; color cannot reveal", 565, 961, 19, gray)
text("the hidden border. A layout rule is still needed.", 565, 989, 19, gray)
text("White halos remain necessary under either color scheme to separate annotations from the app.", 50, 1040, 18, gray)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
