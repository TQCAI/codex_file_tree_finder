import Foundation
import AppKit

func output(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
do {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let action = args.first else { throw NSError(domain: "arguments", code: 1) }
    let paths = Array(args.dropFirst())
    switch action {
    case "copyClipboard":
        let urls = paths.map { NSURL(fileURLWithPath: $0) }
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.writeObjects(urls) else { throw NSError(domain: "clipboard", code: 1) }
        try output(["ok": true])
    case "readClipboard":
        let urls = NSPasteboard.general.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        try output(["paths": urls.map { $0.path }])
    case "trash":
        guard paths.count == 1 else { throw NSError(domain: "arguments", code: 1) }
        var result: NSURL?
        try FileManager.default.trashItem(at: URL(fileURLWithPath: paths[0]), resultingItemURL: &result)
        guard let result = result else { throw NSError(domain: "trash", code: 1) }
        try output(["path": result.path!])
    case "restore":
        guard paths.count == 2 else { throw NSError(domain: "arguments", code: 1) }
        try FileManager.default.moveItem(atPath: paths[0], toPath: paths[1])
        try output(["ok": true])
    case "copy", "move":
        guard paths.count == 2 else { throw NSError(domain: "arguments", code: 1) }
        if action == "copy" {
            try FileManager.default.copyItem(atPath: paths[0], toPath: paths[1])
        } else {
            try FileManager.default.moveItem(atPath: paths[0], toPath: paths[1])
        }
        try output(["ok": true])
    case "tags":
        guard paths.count == 2 else { throw NSError(domain: "arguments", code: 1) }
        let url = NSURL(fileURLWithPath: paths[0])
        let tags = paths[1].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        try url.setResourceValue(tags, forKey: .tagNamesKey)
        try output(["ok": true])
    default: throw NSError(domain: "arguments", code: 1)
    }
} catch {
    FileHandle.standardError.write(Data(error.localizedDescription.utf8))
    exit(1)
}
