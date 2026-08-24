import Foundation

// Bridges to the EXISTING Node/TypeScript core via subprocess — Process +
// Pipe, no persistent server (per V1 scope). This file owns zero parsing,
// validation, trust, or pricing logic; it only shells out to
// dist/src/cliOnce.js and decodes whatever JSON comes back.

// Hardcoded for this machine/user, matching the personal-V1 scope. If this
// app is ever run on a different machine, update these two paths (or read
// them from an environment variable / config file — not needed for V1).
enum LikhoPaths {
    static let nodeExecutable = "/Users/tanishk/.local/bin/node"
    static let cliOnceScript = "/Users/tanishk/likho/dist/src/cliOnce.js"
}

struct LikhoOrderItem: Decodable {
    let name: String
    let quantity: Int
    let unitPrice: Double
}

struct LikhoParsedOrder: Decodable {
    let customer: String?
    let items: [LikhoOrderItem]
    let discountPercent: Double?
}

struct LikhoCliResponse: Decodable {
    let ok: Bool
    let parsed: LikhoParsedOrder?
    let error: String?
}

enum LikhoBridgeError: Error, LocalizedError {
    case nodeNotFound
    case scriptNotFound
    case processFailedToLaunch(String)
    case emptyOutput
    case decodeFailed(String)

    var errorDescription: String? {
        switch self {
        case .nodeNotFound:
            return "Node executable not found at \(LikhoPaths.nodeExecutable)."
        case .scriptNotFound:
            return "cliOnce.js not found at \(LikhoPaths.cliOnceScript). Run `npm run build` in the Likho project."
        case .processFailedToLaunch(let detail):
            return "Failed to launch Node subprocess: \(detail)"
        case .emptyOutput:
            return "Node subprocess produced no output."
        case .decodeFailed(let detail):
            return "Could not decode Node subprocess output: \(detail)"
        }
    }
}

enum LikhoBridge {
    /// Sends `text` to the existing routeParseOrder() core (via cliOnce.js)
    /// and returns its decoded response. Runs on a background queue.
    static func parseOrder(_ text: String) throws -> LikhoCliResponse {
        guard FileManager.default.isExecutableFile(atPath: LikhoPaths.nodeExecutable) else {
            throw LikhoBridgeError.nodeNotFound
        }
        guard FileManager.default.fileExists(atPath: LikhoPaths.cliOnceScript) else {
            throw LikhoBridgeError.scriptNotFound
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: LikhoPaths.nodeExecutable)
        process.arguments = [LikhoPaths.cliOnceScript]

        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch {
            throw LikhoBridgeError.processFailedToLaunch(error.localizedDescription)
        }

        if let data = text.data(using: .utf8) {
            stdinPipe.fileHandleForWriting.write(data)
        }
        stdinPipe.fileHandleForWriting.closeFile()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard !stdoutData.isEmpty else {
            throw LikhoBridgeError.emptyOutput
        }

        do {
            return try JSONDecoder().decode(LikhoCliResponse.self, from: stdoutData)
        } catch {
            throw LikhoBridgeError.decodeFailed(error.localizedDescription)
        }
    }
}
