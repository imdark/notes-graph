// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class UpsertWorkspaceByokConfigMutation: GraphQLMutation {
  public static let operationName: String = "upsertWorkspaceByokConfig"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation upsertWorkspaceByokConfig($input: UpsertWorkspaceByokConfigInput!) { upsertWorkspaceByokConfig(input: $input) { __typename id } }"#
    ))

  public var input: UpsertWorkspaceByokConfigInput

  public init(input: UpsertWorkspaceByokConfigInput) {
    self.input = input
  }

  public var __variables: Variables? { ["input": input] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("upsertWorkspaceByokConfig", UpsertWorkspaceByokConfig.self, arguments: ["input": .variable("input")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      UpsertWorkspaceByokConfigMutation.Data.self
    ] }

    public var upsertWorkspaceByokConfig: UpsertWorkspaceByokConfig { __data["upsertWorkspaceByokConfig"] }

    /// UpsertWorkspaceByokConfig
    ///
    /// Parent Type: `WorkspaceByokKeyConfigType`
    public struct UpsertWorkspaceByokConfig: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceByokKeyConfigType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotesGraphGraphQL.ID.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        UpsertWorkspaceByokConfigMutation.Data.UpsertWorkspaceByokConfig.self
      ] }

      public var id: NotesGraphGraphQL.ID { __data["id"] }
    }
  }
}
