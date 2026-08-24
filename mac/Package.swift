// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LikhoMac",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "LikhoMac",
            path: "Sources/LikhoMac"
        )
    ]
)
