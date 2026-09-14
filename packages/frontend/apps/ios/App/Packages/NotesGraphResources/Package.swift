// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
  name: "NotesGraphResources",
  products: [
    .library(
      name: "NotesGraphResources",
      targets: ["NotesGraphResources"]
    ),
  ],
  targets: [
    .target(
      name: "NotesGraphResources",
      resources: [
        .process("Resources/Icons.xcassets"),
        .process("Resources/Colors.xcassets"),
      ]
    ),
  ]
)
