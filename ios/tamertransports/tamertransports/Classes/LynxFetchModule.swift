import Foundation
import Lynx

@objcMembers
public final class LynxFetchModule: NSObject, LynxModule {

    @objc public static var name: String { "LynxFetchModule" }

    @objc public static var methodLookup: [String: String] {
        [
            "request": NSStringFromSelector(#selector(request(_:optionsJson:callback:))),
            "cancel": NSStringFromSelector(#selector(cancel(_:)))
        ]
    }
    private var activeTasks: [Int: URLSessionDataTask] = [:]
    private var activeSessions: [Int: URLSession] = [:]


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
        let stream = (options["stream"] as? Bool) == true
        let requestId = options["requestId"] as? Int ?? -1

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

        if stream, requestId >= 0 {
            let delegate = StreamingFetchDelegate(callback: callback) { [weak self] in
                self?.activeTasks.removeValue(forKey: requestId)
                self?.activeSessions.removeValue(forKey: requestId)
            }
            let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
            let task = session.dataTask(with: request)
            activeSessions[requestId] = session
            activeTasks[requestId] = task
            task.resume()
            return
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

    @objc func cancel(_ requestId: Int) {
        activeTasks.removeValue(forKey: requestId)?.cancel()
        activeSessions.removeValue(forKey: requestId)?.invalidateAndCancel()
    }

    private func createJSONString(_ dictionary: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: dictionary)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}

private final class StreamingFetchDelegate: NSObject, URLSessionDataDelegate {
    private let callback: (String) -> Void
    private let onComplete: () -> Void

    init(callback: @escaping (String) -> Void, onComplete: @escaping () -> Void) {
        self.callback = callback
        self.onComplete = onComplete
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let httpResponse = response as? HTTPURLResponse
        let status = httpResponse?.statusCode ?? 0
        let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
        var headersObj: [String: String] = [:]
        if let resp = httpResponse {
            for (key, value) in resp.allHeaderFields {
                headersObj[String(describing: key)] = String(describing: value)
            }
        }
        callback(createJSONString([
            "event": "headers",
            "ok": (200...299).contains(status),
            "status": status,
            "statusText": statusText,
            "headers": headersObj,
        ]))
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        callback(createJSONString([
            "event": "chunk",
            "dataBase64": data.base64EncodedString(),
        ]))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { onComplete() }
        if let error = error as NSError?, error.code != NSURLErrorCancelled {
            callback(createJSONString([
                "event": "error",
                "message": error.localizedDescription,
            ]))
            return
        }
        callback(createJSONString(["event": "end"]))
    }

    private func createJSONString(_ dictionary: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: dictionary)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
