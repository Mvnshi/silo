// Silo Share Extension — a lean native share sheet.
//
// Grabs the shared URL / text / image, shows a SwiftUI confirmation sheet
// (preview + category + "Add to Silo"), then hands the payload to the app via a
// deep link (silo://share?...). The app (app/share.tsx) runs the SAME universal
// extractor + Gemini classify pipeline and writes into AsyncStorage. Shared
// images are written into the App Group container so the app can read them.

import UIKit
import SwiftUI
import UniformTypeIdentifiers

struct SharePayload {
  var type: String   // "url" | "text" | "image"
  var value: String  // url string, text, or file:// path inside the app group
  var preview: String
}

class ShareViewController: UIViewController {
  private let appGroup = "group.com.silo.app"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    extractPayload { [weak self] payload in
      DispatchQueue.main.async { self?.presentSheet(payload) }
    }
  }

  private func presentSheet(_ payload: SharePayload) {
    let root = ConfirmView(
      payload: payload,
      onAdd: { [weak self] category in self?.finish(payload, category) },
      onCancel: { [weak self] in self?.cancelShare() }
    )
    let host = UIHostingController(rootView: root)
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    host.didMove(toParent: self)
  }

  private func finish(_ payload: SharePayload, _ category: String) {
    writePending(payload, category)
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  private func cancelShare() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  /// Persist the share into the App Group queue; the app drains it on next
  /// foreground. (iOS blocks openURL from a share extension, so we hand off via
  /// shared storage, not a deep link.) Stored as JSON Data so the app's
  /// ExtensionStorage.get() returns it as a JSON string.
  private func writePending(_ payload: SharePayload, _ category: String) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    let key = "SiloPendingShares"
    var queue: [[String: Any]] = []
    if let data = defaults.data(forKey: key),
       let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      queue = existing
    }
    queue.append([
      "type": payload.type,
      "value": payload.value,
      "category": category,
      "ts": Date().timeIntervalSince1970,
    ])
    if let newData = try? JSONSerialization.data(withJSONObject: queue) {
      defaults.set(newData, forKey: key)
      // Force an immediate flush: completeRequest() kills this process right
      // after, which would otherwise drop the deferred UserDefaults write.
      defaults.synchronize()
    }
  }

  // MARK: - Extract the shared item (prefer URL, then image, then text)

  private func extractPayload(_ completion: @escaping (SharePayload) -> Void) {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
          let providers = item.attachments else {
      completion(SharePayload(type: "text", value: "", preview: ""))
      return
    }
    let urlType = UTType.url.identifier
    let imageType = UTType.image.identifier
    let textType = UTType.plainText.identifier

    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
      p.loadItem(forTypeIdentifier: urlType, options: nil) { data, _ in
        let s = (data as? URL)?.absoluteString ?? ""
        completion(SharePayload(type: "url", value: s, preview: s))
      }
    } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(imageType) }) {
      p.loadItem(forTypeIdentifier: imageType, options: nil) { [weak self] data, _ in
        let path = self?.saveImageToGroup(data) ?? ""
        completion(SharePayload(type: path.isEmpty ? "text" : "image", value: path, preview: "Shared image"))
      }
    } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) {
      p.loadItem(forTypeIdentifier: textType, options: nil) { data, _ in
        let s = (data as? String) ?? ""
        completion(SharePayload(type: "text", value: s, preview: s))
      }
    } else {
      completion(SharePayload(type: "text", value: "", preview: ""))
    }
  }

  private func saveImageToGroup(_ data: NSSecureCoding?) -> String? {
    var bytes: Data?
    if let url = data as? URL { bytes = try? Data(contentsOf: url) }
    else if let img = data as? UIImage { bytes = img.jpegData(compressionQuality: 0.9) }
    else if let d = data as? Data { bytes = d }
    guard let imageData = bytes,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    else { return nil }
    let dest = container.appendingPathComponent("share-\(UUID().uuidString).jpg")
    do {
      try imageData.write(to: dest)
      return dest.absoluteString
    } catch {
      return nil
    }
  }

}

// MARK: - SwiftUI confirmation sheet

struct ConfirmView: View {
  let payload: SharePayload
  let onAdd: (String) -> Void
  let onCancel: () -> Void

  private let categories = [
    "auto", "article", "video", "recipe", "product", "event",
    "place", "idea", "fitness", "food", "career", "academia", "other",
  ]
  @State private var category = "auto"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Add to Silo").font(.headline)
        Spacer()
        Button(action: onCancel) {
          Image(systemName: "xmark.circle.fill")
            .font(.title2)
            .foregroundColor(.secondary)
        }
      }
      .padding()

      VStack(alignment: .leading, spacing: 6) {
        Text(payload.type.uppercased())
          .font(.caption2).bold()
          .foregroundColor(.purple)
        Text(payload.preview.isEmpty ? "Shared content" : payload.preview)
          .font(.subheadline)
          .lineLimit(3)
          .foregroundColor(.primary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding()
      .background(Color(.secondarySystemBackground))
      .cornerRadius(14)
      .padding(.horizontal)

      Text("Category")
        .font(.caption).foregroundColor(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal).padding(.top, 14)

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(categories, id: \.self) { c in
            Text(c)
              .font(.footnote).fontWeight(.semibold)
              .padding(.horizontal, 14).padding(.vertical, 8)
              .background(category == c ? Color.purple : Color(.secondarySystemBackground))
              .foregroundColor(category == c ? .white : .primary)
              .cornerRadius(18)
              .onTapGesture { category = c }
          }
        }
        .padding(.horizontal)
        .padding(.top, 4)
      }

      Spacer()

      Button(action: { onAdd(category) }) {
        Text("Add to Silo")
          .font(.headline).foregroundColor(.white)
          .frame(maxWidth: .infinity).padding()
          .background(Color.purple).cornerRadius(14)
      }
      .padding()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(.systemBackground))
  }
}
