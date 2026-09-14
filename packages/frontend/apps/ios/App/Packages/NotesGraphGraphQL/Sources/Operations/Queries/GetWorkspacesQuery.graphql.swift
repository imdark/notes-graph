// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetWorkspacesQuery: GraphQLQuery {
  public static let operationName: String = "getWorkspaces"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getWorkspaces { workspaces { __typename id initialized team owner { __typename id } } }"#
    ))

  public init() {}

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("workspaces", [Workspace].self),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      GetWorkspacesQuery.Data.self
    ] }

    /// Get all accessible workspaces for current user
    public var workspaces: [Workspace] { __data["workspaces"] }

    /// Workspace
    ///
    /// Parent Type: `WorkspaceType`
    public struct Workspace: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotesGraphGraphQL.ID.self),
        .field("initialized", Bool.self),
        .field("team", Bool.self),
        .field("owner", Owner.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        GetWorkspacesQuery.Data.Workspace.self
      ] }

      public var id: NotesGraphGraphQL.ID { __data["id"] }
      /// is current workspace initialized
      public var initialized: Bool { __data["initialized"] }
      /// if workspace is team workspace
      public var team: Bool { __data["team"] }
      /// Owner of workspace
      public var owner: Owner { __data["owner"] }

      /// Workspace.Owner
      ///
      /// Parent Type: `UserType`
      public struct Owner: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.UserType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", NotesGraphGraphQL.ID.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          GetWorkspacesQuery.Data.Workspace.Owner.self
        ] }

        public var id: NotesGraphGraphQL.ID { __data["id"] }
      }
    }
  }
}
