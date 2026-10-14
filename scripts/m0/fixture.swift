import UIKit

final class FixtureController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 1)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.subviews.forEach { $0.removeFromSuperview() }
        let w = view.bounds.width, h = view.bounds.height
        let targets: [(String, CGRect, UInt32)] = [
            ("top-left", CGRect(x: 8, y: 70, width: 120, height: 48), 0x14B8A6),
            ("top-right", CGRect(x: w-128, y: 70, width: 120, height: 48), 0xF59E0B),
            ("center", CGRect(x: 40, y: 200, width: w-80, height: 100), 0x3B82F6),
            ("partial-left", CGRect(x: -20, y: 360, width: 120, height: 60), 0xA78BFA),
            ("bottom-right", CGRect(x: w-128, y: h-100, width: 120, height: 48), 0xFB7185),
            ("partial-bottom", CGRect(x: 40, y: h-20, width: 160, height: 60), 0x22C55E)
        ]
        for (id, rect, color) in targets {
            let label = UILabel(frame: rect)
            label.text = id
            label.textAlignment = .center
            label.font = .systemFont(ofSize: 13)
            label.textColor = .black
            label.backgroundColor = UIColor(red: CGFloat((color>>16)&255)/255, green: CGFloat((color>>8)&255)/255, blue: CGFloat(color&255)/255, alpha: 1)
            label.isAccessibilityElement = true
            label.accessibilityIdentifier = id
            label.accessibilityLabel = id
            view.addSubview(label)
        }
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}

@main
final class FixtureApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = FixtureController()
        window?.makeKeyAndVisible()
        return true
    }
}
