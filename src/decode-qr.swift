import AppKit
import Foundation
import Vision

enum DecodeError: Error, LocalizedError {
    case missingPath
    case unreadableImage(String)
    case missingCgImage(String)
    case noQrPayload

    var errorDescription: String? {
        switch self {
        case .missingPath:
            return "Missing image path"
        case .unreadableImage(let path):
            return "Could not read image at \(path)"
        case .missingCgImage(let path):
            return "Could not create CGImage from \(path)"
        case .noQrPayload:
            return "No QR code payload found in image"
        }
    }
}

func decodeQrPayload(at path: String) throws -> String {
    let imageUrl = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: imageUrl) else {
        throw DecodeError.unreadableImage(path)
    }

    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw DecodeError.missingCgImage(path)
    }

    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]

    let handler = VNImageRequestHandler(cgImage: cgImage)
    try handler.perform([request])

    guard
        let results = request.results,
        let payload = results.compactMap(\.payloadStringValue).first
    else {
        throw DecodeError.noQrPayload
    }

    return payload
}

do {
    guard CommandLine.arguments.count > 1 else {
        throw DecodeError.missingPath
    }

    let payload = try decodeQrPayload(at: CommandLine.arguments[1])
    print(payload)
} catch {
    let message: String
    if let localized = error as? LocalizedError, let description = localized.errorDescription {
        message = description
    } else {
        message = error.localizedDescription
    }

    FileHandle.standardError.write(Data("Error: \(message)\n".utf8))
    exit(1)
}
