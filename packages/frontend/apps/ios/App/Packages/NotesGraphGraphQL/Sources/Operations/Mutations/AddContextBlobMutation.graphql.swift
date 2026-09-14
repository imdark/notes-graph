// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class AddContextBlobMutation: GraphQLMutation {
  public static let operationName: String = "addContextBlob"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation addContextBlob($options: AddContextBlobInput!) { addContextBlob(options: $options) { __typename id createdAt status } }"#
    ))

  public var options: AddContextBlobInput

  public init(options: AddContextBlobInput) {
    self.options = options
  }

  public var __variables: Variables? { ["options": options] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("addContextBlob", AddContextBlob.self, arguments: ["options": .variable("options")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      AddContextBlobMutation.Data.self
    ] }

    /// add a blob to context
    public var addContextBlob: AddContextBlob { __data["addContextBlob"] }

    /// AddContextBlob
    ///
    /// Parent Type: `CopilotContextBlob`
    public struct AddContextBlob: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.CopilotContextBlob }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotesGraphGraphQL.ID.self),
        .field("createdAt", NotesGraphGraphQL.SafeInt.self),
        .field("status", GraphQLEnum<NotesGraphGraphQL.ContextEmbedStatus>?.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        AddContextBlobMutation.Data.AddContextBlob.self
      ] }

      public var id: NotesGraphGraphQL.ID { __data["id"] }
      public var createdAt: NotesGraphGraphQL.SafeInt { __data["createdAt"] }
      public var status: GraphQLEnum<NotesGraphGraphQL.ContextEmbedStatus>? { __data["status"] }
    }
  }
}
