import Foundation
import Lynx
import Network

@objcMembers
public final class LynxWebSocketModule: NSObject, LynxModule, LynxContextModule, URLSessionWebSocketDelegate {

    @objc public static var name: String { "LynxWebSocketModule" }

    @objc public static var methodLookup: [String: String] {
        [
            "connect": NSStringFromSelector(#selector(connect(_:id:))),
            "send": NSStringFromSelector(#selector(send(_:message:))),
            "sendBinary": NSStringFromSelector(#selector(sendBinary(_:base64:))),
            "close": NSStringFromSelector(#selector(close(_:code:reason:)))
        ]
    }

    public static weak var shared: LynxWebSocketModule?

    private var webSockets: [Int: URLSessionWebSocketTask] = [:]
    private var urlSessions: [Int: URLSession] = [:]
    private var taskToId: [URLSessionWebSocketTask: Int] = [:]
    private let queue = DispatchQueue(label: "com.tamertransports.websocket", qos: .default)
    private weak var lynxContext: LynxContext?

    @objc public init(lynxContext context: LynxContext) {
        super.init()
        lynxContext = context
        Self.shared = self
    }

    @objc public init(param: Any) {
        super.init()
        lynxContext = param as? LynxContext
        Self.shared = self
    }

    @objc public override init() {
        super.init()
        Self.shared = self
    }

    @objc func connect(_ url: String, id: Int) {
        guard let websocketURL = URL(string: url) else {
            emitError(id: id, message: "Invalid URL: \(url)")
            return
        }

        queue.async { [weak self] in
            guard let self = self else { return }
            let config = URLSessionConfiguration.default
            let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            let webSocketTask = session.webSocketTask(with: websocketURL)
            self.webSockets[id] = webSocketTask
            self.urlSessions[id] = session
            self.taskToId[webSocketTask] = id
            webSocketTask.resume()
            self.startReceiving(webSocketTask: webSocketTask, id: id)
        }
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard let id = taskToId[webSocketTask] else { return }
        emitOpen(id: id)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let wsTask = task as? URLSessionWebSocketTask, let id = taskToId[wsTask], let err = error else { return }
        if (err as? URLError)?.code != .cancelled {
            emitError(id: id, message: err.localizedDescription)
        }
        cleanup(id: id)
    }

    @objc func send(_ id: Int, message: String) {
        queue.async { [weak self] in
            guard let self = self, let webSocketTask = self.webSockets[id] else { return }
            webSocketTask.send(.string(message)) { error in
                if let error = error { self.emitError(id: id, message: error.localizedDescription) }
            }
        }
    }

    @objc func sendBinary(_ id: Int, base64: String) {
        queue.async { [weak self] in
            guard let self = self, let webSocketTask = self.webSockets[id],
                  let data = Data(base64Encoded: base64) else { return }
            webSocketTask.send(.data(data)) { error in
                if let error = error { self.emitError(id: id, message: error.localizedDescription) }
            }
        }
    }

    @objc func close(_ id: Int, code: Int, reason: String) {
        queue.async { [weak self] in
            guard let self = self else { return }
            if let webSocketTask = self.webSockets[id] {
                let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
                webSocketTask.cancel(with: closeCode, reason: reason.data(using: .utf8))
            }
            self.cleanup(id: id)
            self.emitClose(id: id, code: code, reason: reason)
        }
    }

    private func startReceiving(webSocketTask: URLSessionWebSocketTask, id: Int) {
        webSocketTask.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text): self.emitMessage(id: id, data: text)
                case .data(let data): self.emitMessageBinary(id: id, data: data)
                @unknown default: self.emitError(id: id, message: "Unknown message type")
                }
                if self.webSockets[id] != nil { self.startReceiving(webSocketTask: webSocketTask, id: id) }
            case .failure(let error):
                if (error as? URLError)?.code != .cancelled { self.emitError(id: id, message: error.localizedDescription) }
                self.cleanup(id: id)
            }
        }
    }

    private func cleanup(id: Int) {
        if let task = webSockets[id] {
            taskToId.removeValue(forKey: task)
        }
        webSockets.removeValue(forKey: id)
        urlSessions.removeValue(forKey: id)
    }

    private func emitOpen(id: Int) { emitEvent("websocket:open", createJSONString(["id": id])) }
    private func emitMessage(id: Int, data: String) { emitEvent("websocket:message", createJSONString(["id": id, "data": data])) }
    private func emitMessageBinary(id: Int, data: Data) {
        let base64 = data.base64EncodedString()
        emitEvent("websocket:message", createJSONString(["id": id, "data": base64, "type": "binary"]))
    }
    private func emitError(id: Int, message: String) { emitEvent("websocket:error", createJSONString(["id": id, "message": message])) }
    private func emitClose(id: Int, code: Int, reason: String) { emitEvent("websocket:close", createJSONString(["id": id, "code": code, "reason": reason])) }

    private func createJSONString(_ dictionary: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: dictionary)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    private func emitEvent(_ eventName: String, _ jsonData: String) {
        DispatchQueue.main.async {
            let params: [[String: Any]] = [["payload": jsonData]]
            guard let ctx = self.lynxContext ?? Self.shared?.lynxContext else { return }
            ctx.sendGlobalEvent(eventName, withParams: params)
        }
    }
}
