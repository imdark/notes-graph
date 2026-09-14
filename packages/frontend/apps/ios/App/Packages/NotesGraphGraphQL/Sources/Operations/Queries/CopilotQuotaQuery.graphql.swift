// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class CopilotQuotaQuery: GraphQLQuery {
  public static let operationName: String = "copilotQuota"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query copilotQuota { currentUser { __typename copilot { __typename quota { __typename limit used } } } }"#
    ))

  public init() {}

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("currentUser", CurrentUser?.self),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      CopilotQuotaQuery.Data.self
    ] }

    /// Get current user
    public var currentUser: CurrentUser? { __data["currentUser"] }

    /// CurrentUser
    ///
    /// Parent Type: `UserType`
    public struct CurrentUser: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.UserType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("copilot", Copilot.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        CopilotQuotaQuery.Data.CurrentUser.self
      ] }

      public var copilot: Copilot { __data["copilot"] }

      /// CurrentUser.Copilot
      ///
      /// Parent Type: `Copilot`
      public struct Copilot: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Copilot }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("quota", Quota.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          CopilotQuotaQuery.Data.CurrentUser.Copilot.self
        ] }

        /// Get the quota of the user in the workspace
        public var quota: Quota { __data["quota"] }

        /// CurrentUser.Copilot.Quota
        ///
        /// Parent Type: `CopilotQuota`
        public struct Quota: NotesGraphGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.CopilotQuota }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("limit", NotesGraphGraphQL.SafeInt?.self),
            .field("used", NotesGraphGraphQL.SafeInt.self),
          ] }
          public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
            CopilotQuotaQuery.Data.CurrentUser.Copilot.Quota.self
          ] }

          public var limit: NotesGraphGraphQL.SafeInt? { __data["limit"] }
          public var used: NotesGraphGraphQL.SafeInt { __data["used"] }
        }
      }
    }
  }
}
