// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "NotesGraphGraphQL",
  platforms: [
    .iOS(.v12),
    .macOS(.v10_14),
    .tvOS(.v12),
    .watchOS(.v5),
  ],
  products: [
    .library(name: "NotesGraphGraphQL", targets: ["NotesGraphGraphQL"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apollographql/apollo-ios", exact: "1.25.4"),
  ],
  targets: [
    .target(
      name: "NotesGraphGraphQL",
      dependencies: [
        .product(name: "ApolloAPI", package: "apollo-ios"),
      ],
      path: "./Sources"
    ),
  ]
)
