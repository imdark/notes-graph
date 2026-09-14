// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class WorkspaceByokSettingsQuery: GraphQLQuery {
  public static let operationName: String = "workspaceByokSettings"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query workspaceByokSettings($id: String!, $from: DateTime!, $to: DateTime!) { workspace(id: $id) { __typename id byokSettings { __typename workspaceId entitled serverEntitled localEntitled entitlementRequired allowedProviders localStorageSupported customEndpointSupported hasAiPlan keys { __typename id provider name description storage configured enabled endpoint endpointEditable sortOrder capabilities testStatus disabledReason lastTestedAt lastTestError lastUsedAt lastErrorAt lastError } warnings { __typename featureKind reason requiredProviders } } byokUsage(from: $from, to: $to) { __typename date featureKind totalTokens } } }"#
    ))

  public var id: String
  public var from: DateTime
  public var to: DateTime

  public init(
    id: String,
    from: DateTime,
    to: DateTime
  ) {
    self.id = id
    self.from = from
    self.to = to
  }

  public var __variables: Variables? { [
    "id": id,
    "from": from,
    "to": to
  ] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("workspace", Workspace.self, arguments: ["id": .variable("id")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      WorkspaceByokSettingsQuery.Data.self
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
        .field("id", NotesGraphGraphQL.ID.self),
        .field("byokSettings", ByokSettings.self),
        .field("byokUsage", [ByokUsage].self, arguments: [
          "from": .variable("from"),
          "to": .variable("to")
        ]),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        WorkspaceByokSettingsQuery.Data.Workspace.self
      ] }

      public var id: NotesGraphGraphQL.ID { __data["id"] }
      public var byokSettings: ByokSettings { __data["byokSettings"] }
      public var byokUsage: [ByokUsage] { __data["byokUsage"] }

      /// Workspace.ByokSettings
      ///
      /// Parent Type: `WorkspaceByokSettingsType`
      public struct ByokSettings: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceByokSettingsType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("workspaceId", String.self),
          .field("entitled", Bool.self),
          .field("serverEntitled", Bool.self),
          .field("localEntitled", Bool.self),
          .field("entitlementRequired", [String].self),
          .field("allowedProviders", [GraphQLEnum<NotesGraphGraphQL.ByokProvider>].self),
          .field("localStorageSupported", Bool.self),
          .field("customEndpointSupported", Bool.self),
          .field("hasAiPlan", Bool.self),
          .field("keys", [Key].self),
          .field("warnings", [Warning].self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          WorkspaceByokSettingsQuery.Data.Workspace.ByokSettings.self
        ] }

        public var workspaceId: String { __data["workspaceId"] }
        public var entitled: Bool { __data["entitled"] }
        public var serverEntitled: Bool { __data["serverEntitled"] }
        public var localEntitled: Bool { __data["localEntitled"] }
        public var entitlementRequired: [String] { __data["entitlementRequired"] }
        public var allowedProviders: [GraphQLEnum<NotesGraphGraphQL.ByokProvider>] { __data["allowedProviders"] }
        public var localStorageSupported: Bool { __data["localStorageSupported"] }
        public var customEndpointSupported: Bool { __data["customEndpointSupported"] }
        public var hasAiPlan: Bool { __data["hasAiPlan"] }
        public var keys: [Key] { __data["keys"] }
        public var warnings: [Warning] { __data["warnings"] }

        /// Workspace.ByokSettings.Key
        ///
        /// Parent Type: `WorkspaceByokKeyConfigType`
        public struct Key: NotesGraphGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceByokKeyConfigType }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("id", NotesGraphGraphQL.ID.self),
            .field("provider", GraphQLEnum<NotesGraphGraphQL.ByokProvider>.self),
            .field("name", String.self),
            .field("description", String?.self),
            .field("storage", GraphQLEnum<NotesGraphGraphQL.ByokKeyStorage>.self),
            .field("configured", Bool.self),
            .field("enabled", Bool.self),
            .field("endpoint", String?.self),
            .field("endpointEditable", Bool.self),
            .field("sortOrder", NotesGraphGraphQL.SafeInt.self),
            .field("capabilities", [String].self),
            .field("testStatus", GraphQLEnum<NotesGraphGraphQL.ByokKeyTestStatus>.self),
            .field("disabledReason", String?.self),
            .field("lastTestedAt", NotesGraphGraphQL.DateTime?.self),
            .field("lastTestError", String?.self),
            .field("lastUsedAt", NotesGraphGraphQL.DateTime?.self),
            .field("lastErrorAt", NotesGraphGraphQL.DateTime?.self),
            .field("lastError", String?.self),
          ] }
          public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
            WorkspaceByokSettingsQuery.Data.Workspace.ByokSettings.Key.self
          ] }

          public var id: NotesGraphGraphQL.ID { __data["id"] }
          public var provider: GraphQLEnum<NotesGraphGraphQL.ByokProvider> { __data["provider"] }
          public var name: String { __data["name"] }
          public var description: String? { __data["description"] }
          public var storage: GraphQLEnum<NotesGraphGraphQL.ByokKeyStorage> { __data["storage"] }
          public var configured: Bool { __data["configured"] }
          public var enabled: Bool { __data["enabled"] }
          public var endpoint: String? { __data["endpoint"] }
          public var endpointEditable: Bool { __data["endpointEditable"] }
          public var sortOrder: NotesGraphGraphQL.SafeInt { __data["sortOrder"] }
          public var capabilities: [String] { __data["capabilities"] }
          public var testStatus: GraphQLEnum<NotesGraphGraphQL.ByokKeyTestStatus> { __data["testStatus"] }
          public var disabledReason: String? { __data["disabledReason"] }
          public var lastTestedAt: NotesGraphGraphQL.DateTime? { __data["lastTestedAt"] }
          public var lastTestError: String? { __data["lastTestError"] }
          public var lastUsedAt: NotesGraphGraphQL.DateTime? { __data["lastUsedAt"] }
          public var lastErrorAt: NotesGraphGraphQL.DateTime? { __data["lastErrorAt"] }
          public var lastError: String? { __data["lastError"] }
        }

        /// Workspace.ByokSettings.Warning
        ///
        /// Parent Type: `WorkspaceByokCapabilityWarningType`
        public struct Warning: NotesGraphGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceByokCapabilityWarningType }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("featureKind", String.self),
            .field("reason", String.self),
            .field("requiredProviders", [GraphQLEnum<NotesGraphGraphQL.ByokProvider>].self),
          ] }
          public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
            WorkspaceByokSettingsQuery.Data.Workspace.ByokSettings.Warning.self
          ] }

          public var featureKind: String { __data["featureKind"] }
          public var reason: String { __data["reason"] }
          public var requiredProviders: [GraphQLEnum<NotesGraphGraphQL.ByokProvider>] { __data["requiredProviders"] }
        }
      }

      /// Workspace.ByokUsage
      ///
      /// Parent Type: `WorkspaceByokUsagePointType`
      public struct ByokUsage: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.WorkspaceByokUsagePointType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("date", NotesGraphGraphQL.DateTime.self),
          .field("featureKind", String.self),
          .field("totalTokens", NotesGraphGraphQL.SafeInt.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          WorkspaceByokSettingsQuery.Data.Workspace.ByokUsage.self
        ] }

        public var date: NotesGraphGraphQL.DateTime { __data["date"] }
        public var featureKind: String { __data["featureKind"] }
        public var totalTokens: NotesGraphGraphQL.SafeInt { __data["totalTokens"] }
      }
    }
  }
}
