import AppKit
import ApplicationServices
import CoreImage
import CoreML
import CoreMedia
import Foundation
import QuartzCore
import ScreenCaptureKit
import Vision

func ms(_ start: Double) -> Double { (CFAbsoluteTimeGetCurrent() - start) * 1000 }
func now() -> Double { CFAbsoluteTimeGetCurrent() }
func error(_ text: String) -> NSError {
  NSError(domain: "JevNative", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
}
func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
    return nil
  }
  return value
}
func str(_ element: AXUIElement, _ name: String) -> String { attr(element, name) as? String ?? "" }
func rect(_ element: AXUIElement) -> CGRect? {
  guard let p = attr(element, kAXPositionAttribute), let s = attr(element, kAXSizeAttribute),
    CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID()
  else { return nil }
  var point = CGPoint.zero
  var size = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &point)
  AXValueGetValue(s as! AXValue, .cgSize, &size)
  return CGRect(origin: point, size: size)
}
func box(_ r: CGRect) -> [Double] { [r.minX, r.minY, r.width, r.height].map { Double($0) } }
struct Element {
  var id = ""
  var bounds: CGRect
  var label: String
  var role: String
  var source: String
  var confidence: Double
  var value: String = ""
  var enabled = true
  // Local-only Finder scope metadata. Never include this in a provider payload.
  var itemURL = ""
  var ax: AXUIElement? = nil
  var json: [String: Any] {
    [
      "id": id, "box": box(bounds), "label": label, "role": role, "source": source,
      "confidence": confidence, "value": value, "enabled": enabled,
      "itemURL": itemURL,
    ]
  }
}

final class FrameStream: NSObject, SCStreamOutput, SCStreamDelegate {
  private let lock = NSLock()
  private var buffer: CVPixelBuffer?
  private var timestamp = 0.0
  private var failure: String?
  let context = CIContext(options: [.cacheIntermediates: false])
  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw)
    else { return }
    lock.lock()
    defer { lock.unlock() }
    if status == .complete, let image = CMSampleBufferGetImageBuffer(sampleBuffer) {
      buffer = image
      timestamp = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    } else if status == .idle, buffer != nil {
      timestamp = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    }
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    lock.lock()
    failure = error.localizedDescription
    lock.unlock()
  }
  func current() -> (CVPixelBuffer?, Double, String?) {
    lock.lock()
    defer { lock.unlock() }
    return (buffer, timestamp, failure)
  }
  func image(after deadline: Double) async throws -> (CGImage, Bool) {
    let started = now()
    while true {
      let (buffer, time, failure) = current()
      if let failure { throw error(failure) }
      if let buffer, time >= deadline || ms(started) > 100 {
        let ci = CIImage(cvPixelBuffer: buffer)
        guard let cg = context.createCGImage(ci, from: ci.extent) else {
          throw error("Cannot convert capture buffer")
        }
        return (cg, time >= deadline)
      }
      if ms(started) > 2000 { throw error("No complete video frame received") }
      try await Task.sleep(nanoseconds: 3_000_000)
    }
  }
}

final class Engine {
  var detector: VNCoreMLModel?
  var window: SCWindow?
  var frame = 0
  var elements: [Element] = []
  var capturedAt = 0.0
  var capturedFreshFrame = false
  var lastImage: CGImage?
  var axEnabled = true
  var ocrFast = false
  var threshold: Float = 0.2
  var stream: SCStream?
  var frames: FrameStream?
  var requireFrameAfter = 0.0
  var streaming = true

  func load(_ path: String) throws {
    let url = URL(fileURLWithPath: path)
    let compiled = url.pathExtension == "mlmodelc" ? url : try MLModel.compileModel(at: url)
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .cpuAndNeuralEngine
    detector = try VNCoreMLModel(for: MLModel(contentsOf: compiled, configuration: configuration))
  }
  func windows() async throws -> [[String: Any]] {
    let content = try await SCShareableContent.excludingDesktopWindows(
      true, onScreenWindowsOnly: true)
    return content.windows.filter {
      $0.windowLayer == 0 && $0.frame.width > 80 && $0.frame.height > 60
    }.map {
      [
        "id": $0.windowID, "title": $0.title ?? "",
        "app": $0.owningApplication?.applicationName ?? "",
        "pid": $0.owningApplication?.processID ?? 0, "box": box($0.frame),
      ]
    }
  }
  func select(_ id: UInt32) async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(
      true, onScreenWindowsOnly: true)
    guard let target = content.windows.first(where: { $0.windowID == id }) else {
      throw error("Window no longer available")
    }
    let changed = window?.windowID != target.windowID || window?.frame.size != target.frame.size
    window = target
    if streaming && (changed || stream == nil) {
      if let stream { try? await stream.stopCapture() }
      let receiver = FrameStream()
      let config = SCStreamConfiguration()
      config.width = Int(target.frame.width)
      config.height = Int(target.frame.height)
      config.showsCursor = false
      config.ignoreShadowsSingleWindow = true
      config.captureResolution = .nominal
      config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
      config.queueDepth = 3
      let capture = SCStream(
        filter: SCContentFilter(desktopIndependentWindow: target), configuration: config,
        delegate: receiver)
      try capture.addStreamOutput(
        receiver, type: .screen,
        sampleHandlerQueue: DispatchQueue(label: "jev.capture", qos: .userInteractive))
      try await capture.startCapture()
      stream = capture
      frames = receiver
    }
  }
  func focus() async throws -> [String: Any] {
    guard let w = window, let pid = w.owningApplication?.processID,
      let app = NSRunningApplication(processIdentifier: pid)
    else { throw error("No selected application") }
    app.activate(options: [])
    let ax = AXUIElementCreateApplication(pid)
    let windows = attr(ax, kAXWindowsAttribute) as? [AXUIElement] ?? []
    if let target = windows.first(where: { rect($0) == w.frame }) {
      AXUIElementPerformAction(target, kAXRaiseAction as CFString)
    }
    AXUIElementSetAttributeValue(ax, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    for _ in 0..<30 {
      if let focused = attr(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute) {
        var observed: pid_t = 0
        AXUIElementGetPid(focused as! AXUIElement, &observed)
        if observed == pid { return ["focused": true] }
      }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    throw error("Could not focus selected application")
  }
  func axElements(_ w: SCWindow) -> (elements: [Element], text: [Element]) {
    guard axEnabled, AXIsProcessTrusted(), let pid = w.owningApplication?.processID else {
      return ([], [])
    }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.08)
    let windows = attr(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
    guard
      let root = windows.min(by: { a, b in
        let ra = rect(a) ?? .zero
        let rb = rect(b) ?? .zero
        return abs(ra.minX - w.frame.minX) + abs(ra.minY - w.frame.minY) < abs(
          rb.minX - w.frame.minX) + abs(rb.minY - w.frame.minY)
      })
    else { return ([], []) }
    var result: [Element] = []
    var readable: [Element] = []
    var visited = 0
    let roles: Set<String> = [
      "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuItem", "AXTextField",
      "AXComboBox", "AXLink", "AXTab", "AXSlider", "AXSwitch",
    ]
    func walk(_ node: AXUIElement, _ depth: Int) {
      visited += 1
      if depth > 18 || visited > 700 { return }
      let role = str(node, kAXRoleAttribute)
      if str(node, kAXSubroleAttribute) == "AXSecureTextField" { return }
      if role == "AXStaticText", let r = rect(node), w.frame.intersects(r) {
        let text =
          str(node, kAXValueAttribute).isEmpty
          ? str(node, kAXTitleAttribute) : str(node, kAXValueAttribute)
        if !text.isEmpty {
          readable.append(
            Element(
              bounds: r, label: String(text.prefix(500)), role: role,
              source: "ax", confidence: 1))
        }
      }
      if roles.contains(role), let r = rect(node), r.width > 2, r.height > 2, w.frame.intersects(r)
      {
        let label =
          [
            str(node, kAXTitleAttribute), str(node, kAXDescriptionAttribute),
            str(node, kAXHelpAttribute),
          ].first(where: { !$0.isEmpty }) ?? ""
        let value = attr(node, kAXValueAttribute).map { String(describing: $0) } ?? ""
        let enabled = attr(node, kAXEnabledAttribute) as? Bool ?? true
        result.append(
          Element(
            bounds: r, label: label, role: role, source: "ax", confidence: 1,
            value: String(value.prefix(160)), enabled: enabled,
            itemURL: (attr(node, kAXURLAttribute) as? URL)?.absoluteString ?? "", ax: node))
      }
      for child in attr(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
        walk(child, depth + 1)
      }
    }
    walk(root, 0)
    return (result, readable)
  }
  func observe() async throws -> [String: Any] {
    guard let previous = window else { throw error("Select a window first") }
    let begin = now()
    // Refresh window origin/size after moves. Never use a stale display transform.
    let infos =
      CGWindowListCopyWindowInfo(.optionIncludingWindow, previous.windowID) as? [[String: Any]]
      ?? []
    guard let info = infos.first, let bounds = info[kCGWindowBounds as String] as? [String: Any],
      let liveRect = CGRect(dictionaryRepresentation: bounds as CFDictionary)
    else { throw error("Selected window disappeared") }
    if liveRect != previous.frame { try await select(previous.windowID) }
    guard let w = window else { throw error("Window missing") }
    let filter = SCContentFilter(desktopIndependentWindow: w)
    let config = SCStreamConfiguration()
    config.width = Int(w.frame.width)
    config.height = Int(w.frame.height)
    config.showsCursor = false
    config.ignoreShadowsSingleWindow = true
    config.captureResolution = .nominal
    let captureStart = now()
    let image: CGImage
    var freshFrame = true
    if streaming, let frames {
      let result = try await frames.image(after: requireFrameAfter)
      image = result.0
      freshFrame = result.1
    } else {
      image = try await SCScreenshotManager.captureImage(
        contentFilter: filter, configuration: config)
    }
    let captureMs = ms(captureStart)
    lastImage = image
    let visionStart = now()
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = ocrFast ? .fast : .accurate
    text.usesLanguageCorrection = false
    text.recognitionLanguages = ["en-US"]
    text.minimumTextHeight = 0.008
    var detection: VNCoreMLRequest?
    if let detector {
      let req = VNCoreMLRequest(model: detector)
      req.imageCropAndScaleOption = .scaleFill
      detection = req
    }
    let ocrTask = Task.detached(priority: .userInitiated) { () throws -> Double in
      let start = now()
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([text])
      return ms(start)
    }
    let detectionRequest = detection
    let detectionTask = Task.detached(priority: .userInitiated) { () throws -> Double in
      guard let request = detectionRequest else { return 0 }
      let start = now()
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
      return ms(start)
    }
    let ocrMs = try await ocrTask.value
    let detectorMs = try await detectionTask.value
    let visionMs = ms(visionStart)
    func global(_ r: CGRect) -> CGRect {
      CGRect(
        x: w.frame.minX + r.minX * w.frame.width, y: w.frame.minY + (1 - r.maxY) * w.frame.height,
        width: r.width * w.frame.width, height: r.height * w.frame.height)
    }
    let words = (text.results ?? []).compactMap { item -> Element? in
      guard let candidate = item.topCandidates(1).first else { return nil }
      return Element(
        bounds: global(item.boundingBox), label: candidate.string, role: "text", source: "ocr",
        confidence: Double(candidate.confidence))
    }
    let icons = (detection?.results as? [VNRecognizedObjectObservation] ?? []).filter {
      $0.confidence >= threshold
    }.map {
      Element(
        bounds: global($0.boundingBox), label: "", role: "control", source: "omniparser",
        confidence: Double($0.confidence))
    }
    let axStart = now()
    let axResult = axElements(w)
    let accessible = axResult.elements
    // Resolve duplicate/conflicting OCR locally by geometry. Native labels and values
    // are authoritative for their own regions; OCR still covers inaccessible content.
    let nativeRegions = accessible + axResult.text
    let uncoveredWords = words.filter { word in
      !nativeRegions.contains { item in
        item.bounds.insetBy(dx: -3, dy: -3).contains(
          CGPoint(x: word.bounds.midX, y: word.bounds.midY))
      }
    }
    let axMs = ms(axStart)
    var merged: [Element] = []
    var matchedWords = Set<Int>()
    var matchedAX = Set<Int>()
    for var icon in icons {
      let contained = words.enumerated().filter { pair in
        let text = pair.element.bounds
        if icon.bounds.insetBy(dx: -3, dy: -3).contains(CGPoint(x: text.midX, y: text.midY)) {
          return true
        }
        // Checkboxes/radio icons often occupy the left edge of a longer OCR line.
        let overlap = icon.bounds.intersection(text)
        return icon.bounds.width < 48 && !overlap.isNull
          && overlap.width * overlap.height > icon.bounds.width * icon.bounds.height * 0.45
          && abs(text.midY - icon.bounds.midY) < 12
      }
      icon.label = contained.map { $0.element.label }.joined(separator: " ")
      contained.forEach { matchedWords.insert($0.offset) }
      if let match = accessible.enumerated().filter({
        $0.element.bounds.contains(CGPoint(x: icon.bounds.midX, y: icon.bounds.midY))
          || icon.bounds.contains(CGPoint(x: $0.element.bounds.midX, y: $0.element.bounds.midY))
      }).min(by: { a, b in
        abs(a.element.bounds.midX - icon.bounds.midX)
          + abs(a.element.bounds.midY - icon.bounds.midY) < abs(
            b.element.bounds.midX - icon.bounds.midX)
          + abs(b.element.bounds.midY - icon.bounds.midY)
      }) {
        matchedAX.insert(match.offset)
        if !match.element.label.isEmpty { icon.label = match.element.label }
        icon.role = match.element.role
        icon.value = match.element.value
        icon.enabled = match.element.enabled
        icon.itemURL = match.element.itemURL
        icon.ax = match.element.ax
        icon.bounds = match.element.bounds
        icon.source += "+ax"
      }
      if !contained.isEmpty { icon.source += "+ocr" }
      merged.append(icon)
    }
    merged += accessible.enumerated().filter { !matchedAX.contains($0.offset) }.map { $0.element }
    // OCR also exposes text-only links or labels missed by the detector.
    merged += words.enumerated().filter { pair in
      !matchedWords.contains(pair.offset)
        && !nativeRegions.contains { item in
          item.bounds.insetBy(dx: -3, dy: -3).contains(
            CGPoint(x: pair.element.bounds.midX, y: pair.element.bounds.midY))
        }
    }.map { $0.element }
    // Keep deterministic reading order; IDs are valid only for this frame.
    merged.sort {
      abs($0.bounds.minY - $1.bounds.minY) > 8
        ? $0.bounds.minY < $1.bounds.minY : $0.bounds.minX < $1.bounds.minX
    }
    frame += 1
    elements = Array(merged.prefix(160)).enumerated().map { index, e in
      var copy = e
      copy.id = "e\(index)"
      return copy
    }
    capturedAt = now()
    capturedFreshFrame = freshFrame
    return [
      "frame": frame, "window": w.windowID, "title": w.title ?? "", "bounds": box(w.frame),
      "elements": elements.map { $0.json },
      "text": axResult.text.map { $0.label } + uncoveredWords.map { $0.label },
      "ocrText": uncoveredWords.map { $0.label }, "axText": axResult.text.map { $0.label },
      "rawOCRText": words.map { $0.label },
      "metrics": [
        "captureMs": captureMs, "visionMs": visionMs, "ocrMs": ocrMs, "detectorMs": detectorMs,
        "axMs": axMs, "observeMs": ms(begin), "detected": icons.count, "ocr": words.count,
        "ax": accessible.count,
      ], "detector": detector != nil, "freshFrame": freshFrame,
      "captureMode": streaming ? "stream" : "screenshot",
    ]
  }
  func validatedTarget(_ command: [String: Any], key: String = "target") throws -> (Element, CGPoint) {
    guard AXIsProcessTrusted() else {
      throw error("Accessibility permission is required for input")
    }
    guard let expected = command["frame"] as? Int, expected == frame, capturedFreshFrame,
      ms(capturedAt) < 3000
    else {
      throw error("Stale frame; observe again")
    }
    guard let id = command[key] as? String,
      let element = elements.first(where: { $0.id == id }), element.enabled
    else { throw error("Unknown or disabled element") }
    guard let w = window, let pid = w.owningApplication?.processID else {
      throw error("No selected application")
    }
    let system = AXUIElementCreateSystemWide()
    guard let focused = attr(system, kAXFocusedApplicationAttribute) else {
      throw error("Cannot read focused application")
    }
    var frontPID: pid_t = 0
    AXUIElementGetPid(focused as! AXUIElement, &frontPID)
    guard frontPID == pid else {
      throw error(
        "Target application is not frontmost; focus it before running (expected \(pid), observed \(frontPID))"
      )
    }
    let point = CGPoint(x: element.bounds.midX, y: element.bounds.midY)
    guard w.frame.contains(point) else { throw error("Target outside selected window") }
    let windows =
      CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let hit = windows.first { item in
      guard (item[kCGWindowLayer as String] as? Int ?? -1) == 0,
        let raw = item[kCGWindowBounds as String] as? [String: Any],
        let r = CGRect(dictionaryRepresentation: raw as CFDictionary)
      else { return false }
      return r.contains(point)
    }
    guard hit?[kCGWindowNumber as String] as? UInt32 == w.windowID else {
      throw error("Selected window is covered at the click point")
    }
    guard let raw = hit?[kCGWindowBounds as String] as? [String: Any],
      let liveRect = CGRect(dictionaryRepresentation: raw as CFDictionary), liveRect == w.frame
    else { throw error("Window moved since observation") }
    if let ax = element.ax {
      guard attr(ax, kAXEnabledAttribute) as? Bool ?? true else {
        throw error("Element became disabled")
      }
      guard let r = rect(ax), r.insetBy(dx: -4, dy: -4).contains(point) else {
        throw error("Element moved since observation (expected \(box(element.bounds)), live \(rect(ax).map { box($0) } ?? []))")
      }
      let value = attr(ax, kAXValueAttribute).map { String(describing: $0) } ?? ""
      guard String(value.prefix(160)) == element.value else {
        throw error("Element value changed since observation")
      }
      let liveURL = (attr(ax, kAXURLAttribute) as? URL)?.absoluteString ?? ""
      guard liveURL == element.itemURL else { throw error("Finder item changed since observation") }
    }
    return (element, point)
  }
  func execute(_ command: [String: Any]) throws -> [String: Any] {
    let (element, point) = try validatedTarget(command)
    let source = CGEventSource(stateID: .hidSystemState)
    let start = now()
    CGEvent(
      mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point,
      mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(
      mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point,
      mouseButton: .left)?.post(tap: .cghidEventTap)
    requireFrameAfter = CACurrentMediaTime() + 0.016
    return [
      "clicked": element.id, "label": element.label, "point": [point.x, point.y], "actionMs": ms(start),
    ]
  }
  func validateDrag(_ command: [String: Any]) throws -> (Element, CGPoint, Element, CGPoint) {
    let (sourceElement, from) = try validatedTarget(command, key: "source")
    let (destination, to) = try validatedTarget(command, key: "destination")
    guard window?.owningApplication?.bundleIdentifier == "com.apple.finder",
      sourceElement.id != destination.id,
      sourceElement.role == "AXTextField", destination.role == "AXTextField",
      let sourceAX = sourceElement.ax, destination.ax != nil,
      let sourceURL = URL(string: sourceElement.itemURL), sourceURL.isFileURL,
      let destinationURL = URL(string: destination.itemURL), destinationURL.isFileURL,
      !sourceURL.hasDirectoryPath, destinationURL.hasDirectoryPath,
      let root = command["root"] as? String, root.hasPrefix("/"),
      sourceURL.deletingLastPathComponent().standardizedFileURL.path == URL(fileURLWithPath: root).standardizedFileURL.path,
      destinationURL.deletingLastPathComponent().standardizedFileURL.path == URL(fileURLWithPath: root).standardizedFileURL.path
    else { throw error("Drag requires two direct Finder items in the approved folder") }
    // A Finder drag can otherwise move every selected row, not just its source.
    var ancestor: AXUIElement? = sourceAX
    var checkedSelection = false
    for _ in 0..<8 {
      guard let current = ancestor else { break }
      if str(current, kAXRoleAttribute) == "AXOutline" {
        guard let selected = attr(current, kAXSelectedRowsAttribute) as? [AXUIElement],
          selected.count <= 1
        else { throw error("Clear multiple Finder selections before dragging") }
        checkedSelection = true
        break
      }
      ancestor = attr(current, kAXParentAttribute).map { $0 as! AXUIElement }
    }
    guard checkedSelection else { throw error("Cannot verify Finder selection") }
    return (sourceElement, from, destination, to)
  }
  func drag(_ command: [String: Any]) throws -> [String: Any] {
    let (sourceElement, from, destination, to) = try validateDrag(command)
    let eventSource = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseDown,
      mouseCursorPosition: from, mouseButton: .left),
      let up = CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseUp,
      mouseCursorPosition: to, mouseButton: .left)
    else { throw error("Cannot create drag events") }
    // A deliberate lateral arc crosses Finder's drag threshold even for adjacent rows.
    let bend = min(max(from.x, to.x) + 110, window!.frame.maxX - 20)
    var previousPoint = from
    let moves = (1...24).compactMap { step -> CGEvent? in
      let t = Double(step) / 24, u = 1 - t
      let point = CGPoint(x: u * u * from.x + 2 * u * t * bend + t * t * to.x,
        y: from.y + (to.y - from.y) * t)
      let event = CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseDragged,
        mouseCursorPosition: point, mouseButton: .left)
      event?.setIntegerValueField(.mouseEventDeltaX, value: Int64((point.x - previousPoint.x).rounded()))
      event?.setIntegerValueField(.mouseEventDeltaY, value: Int64((point.y - previousPoint.y).rounded()))
      previousPoint = point
      return event
    }
    guard moves.count == 24 else { throw error("Cannot create drag path") }
    let start = now()
    down.setIntegerValueField(.mouseEventClickState, value: 1)
    up.setIntegerValueField(.mouseEventClickState, value: 1)
    CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved,
      mouseCursorPosition: from, mouseButton: .left)?.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.03)
    down.post(tap: .cghidEventTap)
    defer { up.post(tap: .cghidEventTap) }
    Thread.sleep(forTimeInterval: 0.12)
    for move in moves {
      move.setIntegerValueField(.mouseEventClickState, value: 1)
      move.post(tap: .cghidEventTap)
      Thread.sleep(forTimeInterval: 0.015)
    }
    Thread.sleep(forTimeInterval: 0.12)
    requireFrameAfter = CACurrentMediaTime() + 0.08
    return ["dragged": sourceElement.id, "destination": destination.id, "actionMs": ms(start)]
  }
}

@main struct Main {
  static func main() async {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.prohibited)
    let engine = Engine()
    while let line = readLine() {
      do {
        guard let data = line.data(using: .utf8),
          let command = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw error("Expected JSON object") }
        var result: [String: Any] = [:]
        switch command["op"] as? String {
        case "hello":
          result = [
            "screenRecording": CGPreflightScreenCaptureAccess(),
            "accessibility": AXIsProcessTrusted(), "pid": ProcessInfo.processInfo.processIdentifier,
          ]
        case "load":
          try engine.load(command["path"] as? String ?? "")
          result = ["loaded": true]
        case "windows": result = ["windows": try await engine.windows()]
        case "select":
          engine.streaming = command["streaming"] as? Bool ?? true
          try await engine.select(UInt32(command["id"] as? Int ?? 0))
          engine.axEnabled = command["ax"] as? Bool ?? true
          engine.ocrFast = command["fastOCR"] as? Bool ?? false
          result = ["selected": true]
        case "focus": result = try await engine.focus()
        case "observe": result = try await engine.observe()
        case "click": result = try engine.execute(command)
        case "drag": result = try engine.drag(command)
        case "validate-drag":
          _ = try engine.validateDrag(command)
          result = ["valid": true]
        case "save":
          guard let image = engine.lastImage, let path = command["path"] as? String else {
            throw error("No image")
          }
          let rep = NSBitmapImageRep(cgImage: image)
          try rep.representation(using: .png, properties: [:])!.write(
            to: URL(fileURLWithPath: path))
          result = ["saved": true]
        case "quit": return
        default: throw error("Unknown operation")
        }
        result["requestId"] = command["requestId"]
        let responseData = try JSONSerialization.data(
          withJSONObject: result, options: [.sortedKeys])
        print(String(data: responseData, encoding: .utf8)!)
        fflush(stdout)
      } catch {
        let data = try! JSONSerialization.data(withJSONObject: ["error": error.localizedDescription]
        )
        print(String(data: data, encoding: .utf8)!)
        fflush(stdout)
      }
    }
  }
}
