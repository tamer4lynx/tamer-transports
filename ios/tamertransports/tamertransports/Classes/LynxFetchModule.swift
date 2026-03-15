import Foundation
import Lynx

@objcMembers
public final class LynxFetchModule: NSObject, LynxModule {

    @objc public static var name: String { "LynxFetchModule" }

    @objc public static var methodLookup: [String: String] {
        ["request": NSStringFromSelector(#selector(request(_:optionsJson:callback:)))]
    }

    @objc public init(param: Any) { super.init() }
    @objc public override init() { super.init() }

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
        let body = options["body"] as? String

        var request = URLRequest(url: urlObj)
        request.httpMethod = method
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if let body = body, !["GET", "HEAD"].contains(method) {
            request.httpBody = body.data(using: .utf8)
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                callback(self.createJSONString(["error": error.localizedDescription]))
                return
            }

            let httpResponse = response as? HTTPURLResponse
            let status = httpResponse?.statusCode ?? 0
            let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
            let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""

            var headersObj: [String: String] = [:]
            if let resp = httpResponse {
                for (key, value) in resp.allHeaderFields where key is String && value is String {
                    headersObj[key as! String] = value as? String
                }
            }

            let result: [String: Any] = [
                "ok": (200...299).contains(status),
                "status": status,
                "statusText": statusText,
                "headers": headersObj,
                "body": bodyStr
            ]
            callback(self.createJSONString(result))
        }.resume()
    }

    private func createJSONString(_ dictionary: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: dictionary)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
