// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetWorkspacePublicPagesQuery: GraphQLQuery {
  public static let operationName: String = "getWorkspacePublicPages"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getWorkspacePublicPages($workspaceId: String!) { workspace(id: $workspaceId) { __typename publicDocs { __typename id mode } } }"#
    ))

  public var workspaceId: String

  public init(workspaceId: String) {
    self.workspaceId = workspaceId
  }

  public var __variables: Variables? { ["workspaceId": workspaceId] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("workspace", Workspace.self, arguments: ["id": .variable("workspaceId")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      GetWorkspacePublicPagesQuery.Data.self
    ] }

    /// Get workspace by id
    public var workspace: Workspace { __data["workspace"] }

    /// Workspace
    ///
    /// Parent Type: `WorkspaceType`
    public struct Workspace: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("publicDocs", [PublicDoc].self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        GetWorkspacePublicPagesQuery.Data.Workspace.self
      ] }

      /// Get public docs of a workspace
      public var publicDocs: [PublicDoc] { __data["publicDocs"] }

      /// Workspace.PublicDoc
      ///
      /// Parent Type: `DocType`
      public struct PublicDoc: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.DocType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", String.self),
          .field("mode", GraphQLEnum<NotesGraphGraphQL.PublicDocMode>.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          GetWorkspacePublicPagesQuery.Data.Workspace.PublicDoc.self
        ] }

        public var id: String { __data["id"] }
        public var mode: GraphQLEnum<NotesGraphGraphQL.PublicDocMode> { __data["mode"] }
      }
    }
  }
}
