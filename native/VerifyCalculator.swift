import AppKit
import ApplicationServices
import Foundation

// Independent benchmark oracle. The agent never reads this result.
func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
  var result: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else {
    return nil
  }
  return result
}
func display(_ element: AXUIElement, _ depth: Int = 0, _ inDisplay: Bool = false) -> String? {
  if depth > 16 { return nil }
  let identifier = value(element, kAXIdentifierAttribute) as? String ?? ""
  let inside = inDisplay || identifier == "StandardInputView"
  if inside, value(element, kAXRoleAttribute) as? String == "AXStaticText",
    let text = value(element, kAXValueAttribute) as? String
  {
    return String(
      text.unicodeScalars.filter {
        !CharacterSet.controlCharacters.contains($0)
          && !CharacterSet(charactersIn: "\u{200e}\u{200f}\u{202a}\u{202c}").contains($0)
      })
  }
  for child in value(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
    if let text = display(child, depth + 1, inside) { return text }
  }
  return nil
}
let expected = CommandLine.arguments.dropFirst().first ?? ""
let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.calculator")
  .first
var actual: String?
if let app {
  let root = AXUIElementCreateApplication(app.processIdentifier)
  for window in value(root, kAXWindowsAttribute) as? [AXUIElement] ?? [] {
    actual = display(window)
    if actual != nil { break }
  }
}
let passed = actual?.replacingOccurrences(of: ",", with: "") == expected && !expected.isEmpty
let output: [String: Any] = [
  "passed": passed, "expected": expected, "display": actual ?? "unavailable",
  "source": "Calculator StandardInputView via independent AX reader",
]
let data = try JSONSerialization.data(withJSONObject: output, options: .sortedKeys)
print(String(data: data, encoding: .utf8)!)
exit(passed ? 0 : 1)
