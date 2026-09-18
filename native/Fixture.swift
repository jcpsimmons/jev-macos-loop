import AppKit
import Foundation

// A real native UI. The agent receives no handles to this app's state.
// Results are written separately for the benchmark's independent verifier.
final class Fixture: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  var page = "home"
  var theme = "Light"
  var notifications = false
  var saved = false
  var project = ""
  let out =
    ProcessInfo.processInfo.environment["JEV_FIXTURE_RESULT"] ?? "/tmp/jev-fixture-result.json"
  let mode = ProcessInfo.processInfo.environment["JEV_FIXTURE_MODE"] ?? "native"
  var clicks: [String] = []
  let variant = Int(ProcessInfo.processInfo.environment["JEV_FIXTURE_VARIANT"] ?? "0") ?? 0
  let demoStatus = ProcessInfo.processInfo.environment["JEV_DEMO_STATUS_FILE"]
  var stopwatch: NSTextField?
  var demoTimer: Timer?
  func applicationDidFinishLaunching(_ notification: Notification) {
    window = NSWindow(
      contentRect: NSRect(x: 220, y: 220, width: 900, height: 610),
      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.title = "Jev Loop Lab"
    NSApp.setActivationPolicy(.regular)
    render()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    if demoStatus != nil {
      demoTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
        self?.updateStopwatch()
      }
    }
  }
  func updateStopwatch() {
    guard let demoStatus, let data = try? Data(contentsOf: URL(fileURLWithPath: demoStatus)),
      let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    let phase = state["phase"] as? String ?? "READY"
    let start = state["startedAt"] as? Double ?? 0
    let elapsed =
      phase == "RUNNING"
      ? max(0, Date().timeIntervalSince1970 * 1000 - start)
      : (state["elapsedMs"] as? Double ?? 0)
    stopwatch?.stringValue = String(
      format: "%@   %05.2f s   •   %@", phase, elapsed / 1000,
      state["provider"] as? String ?? "Jev")
  }
  func label(_ title: String, _ x: Double, _ y: Double, _ size: Double = 24) {
    let text = NSTextField(labelWithString: title)
    text.font = NSFont.systemFont(ofSize: size, weight: .medium)
    text.frame = NSRect(x: x, y: y, width: 820, height: size + 12)
    window.contentView!.addSubview(text)
  }
  func button(_ title: String, _ x: Double, _ y: Double, _ action: Selector) {
    let b = NSButton(title: title, target: self, action: action)
    b.bezelStyle = .rounded
    b.font = NSFont.systemFont(ofSize: 20)
    b.frame = NSRect(x: x, y: y, width: 220, height: 58)
    window.contentView!.addSubview(b)
  }
  func render() {
    window.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 900, height: 610))
    label("Jev Loop Lab", 36, 548, 30)
    label("Local native app • live clicks • independent result log", 36, 512, 16)
    switch page {
    case "home":
      label("Workspace", 36, 424)
      button("Settings", variant % 2 == 0 ? 40 : 580, 325, #selector(settings))
      button("Projects", 310, 325, #selector(projects))
      button("Reports", variant % 2 == 0 ? 580 : 40, 325, #selector(reports))
      label("Choose a workspace section", 40, 238, 18)
    case "settings":
      label("Appearance", 40, 424)
      button("Light", 40, 330, #selector(light))
      button("Dark", 310, 330, #selector(dark))
      label("Current theme: \(theme)", 40, 294, 18)
      let b = NSButton(
        checkboxWithTitle: "Enable notifications", target: self, action: #selector(toggle))
      b.font = NSFont.systemFont(ofSize: 20)
      b.frame = NSRect(x: 44, y: 231, width: 340, height: 42)
      b.state = notifications ? .on : .off
      window.contentView!.addSubview(b)
      button("Save settings", 40, 120, #selector(save))
      button("Back", 310, 120, #selector(home))
    case "saved":
      label("Settings saved successfully", 40, 410, 28)
      label("Theme: \(theme)", 40, 340, 22)
      label("Notifications: \(notifications ? "enabled" : "disabled")", 40, 290, 22)
      button("Back", 40, 150, #selector(home))
    case "projects":
      label("Projects", 40, 424)
      button("Project Atlas", variant % 2 == 0 ? 40 : 310, 330, #selector(atlas))
      button("Project Borealis", variant % 2 == 0 ? 310 : 40, 330, #selector(borealis))
      button("Back", 580, 330, #selector(home))
    case "project":
      label("\(project) overview", 40, 410, 28)
      label("Status: Active", 40, 342, 22)
      button("Back", 40, 220, #selector(home))
    default:
      label("Reports", 40, 410)
      button("Back", 40, 220, #selector(home))
    }
    if demoStatus != nil {
      label("Goal: Dark appearance + notifications on + save", 40, 72, 17)
      let clock = NSTextField(labelWithString: "READY   00.00 s")
      clock.font = NSFont.monospacedDigitSystemFont(ofSize: 25, weight: .semibold)
      clock.frame = NSRect(x: 40, y: 22, width: 820, height: 40)
      window.contentView!.addSubview(clock)
      stopwatch = clock
      updateStopwatch()
    }
    let state: [String: Any] = [
      "pid": ProcessInfo.processInfo.processIdentifier, "variant": variant, "page": page,
      "theme": theme, "notifications": notifications, "saved": saved, "project": project,
      "clicks": clicks, "timestamp": Date().timeIntervalSince1970,
    ]
    try? JSONSerialization.data(withJSONObject: state, options: .sortedKeys).write(
      to: URL(fileURLWithPath: out), options: .atomic)
  }
  func change(_ action: String, _ body: () -> Void) {
    clicks.append(action)
    body()
    render()
  }
  @objc func settings() { change("Settings") { page = "settings" } }
  @objc func projects() { change("Projects") { page = "projects" } }
  @objc func reports() { change("Reports") { page = "reports" } }
  @objc func light() { change("Light") { theme = "Light" } }
  @objc func dark() { change("Dark") { theme = "Dark" } }
  @objc func toggle() { change("Enable notifications") { notifications.toggle() } }
  @objc func save() {
    change("Save settings") {
      saved = true
      page = "saved"
    }
  }
  @objc func home() { change("Back") { page = "home" } }
  @objc func atlas() {
    change("Project Atlas") {
      project = "Project Atlas"
      page = "project"
    }
  }
  @objc func borealis() {
    change("Project Borealis") {
      project = "Project Borealis"
      page = "project"
    }
  }
}
let delegate = Fixture()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
