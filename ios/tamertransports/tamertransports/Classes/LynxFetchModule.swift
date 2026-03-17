import Foundation
import Lynx

@objcMembers
public final class LynxFetchModule: NSObject, LynxModule {

    @objc public static var name: String { "LynxFetchModule" }

    @objc public static var methodLookup: [String: String] {
        ["request": NSStringFromSelector(#selector(request(_:optionsJson:callback:)))]
    }

    private static let binaryPrefixes = [
        "application/octet-stream",
        "application/pdf",
        "application/dns-message",
        "application/wasm",
        "image/",
        "audio/",
        "video/",
    ]

    @objc public init(param: Any) { super.init() }
    @objc public override init() { super.init() }

    private func isBinaryContentType(_ contentType: String?) -> Bool {
        guard let ct = contentType else { return false }
        return Self.binaryPrefixes.contains { ct.hasPrefix($0) }
    }

    @objc func request(_ url: String, optionsJson: String, callback: @escaping (String) -> Void) {
        guard let urlObj = URL(string: url) else {
            callback(createJSONString(["error": "Invalid URL"]))
            return
        }

        var options: [String: Any] = [:]
        if let data = optionsJson.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            options = parsed
        }

        let method = (options["method"] as? String)?.uppercased() ?? "GET"
        let headers = options["headers"] as? [String: String] ?? [:]
        let bodyStr = options["body"] as? String
        let bodyBase64 = options["bodyBase64"] as? String

        var request = URLRequest(url: urlObj)
        request.httpMethod = method
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if !["GET", "HEAD"].contains(method) {
            if let base64 = bodyBase64, !base64.isEmpty, let bodyData = Data(base64Encoded: base64) {
                request.httpBody = bodyData
            } else if let body = bodyStr {
                request.httpBody = body.data(using: .utf8)
            }
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                callback(self.createJSONString(["error": error.localizedDescription]))
                return
            }

            let httpResponse = response as? HTTPURLResponse
            let status = httpResponse?.statusCode ?? 0
            let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
            let contentType = httpResponse?.value(forHTTPHeaderField: "Content-Type")

            var headersObj: [String: String] = [:]
            if let resp = httpResponse {
                for (key, value) in resp.allHeaderFields where key is String && value is String {
                    headersObj[key as! String] = value as? String
                }
            }

            var result: [String: Any] = [
                "ok": (200...299).contains(status),
                "status": status,
                "statusText": statusText,
                "headers": headersObj,
            ]
            if let data = data, !data.isEmpty, self.isBinaryContentType(contentType) {
                result["bodyBase64"] = data.base64EncodedString()
            } else {
                result["body"] = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            }
            callback(self.createJSONString(result))
        }.resume()
    }

    private func createJSONString(_ dictionary: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: dictionary)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
