// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ServerConfigQuery: GraphQLQuery {
  public static let operationName: String = "serverConfig"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query serverConfig { serverConfig { __typename version baseUrl name features type initialized calendarProviders credentialsRequirement { __typename ...CredentialsRequirements } } }"#,
      fragments: [CredentialsRequirements.self, PasswordLimits.self]
    ))

  public init() {}

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("serverConfig", ServerConfig.self),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      ServerConfigQuery.Data.self
    ] }

    /// server config
    public var serverConfig: ServerConfig { __data["serverConfig"] }

    /// ServerConfig
    ///
    /// Parent Type: `ServerConfigType`
    public struct ServerConfig: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.ServerConfigType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("version", String.self),
        .field("baseUrl", String.self),
        .field("name", String.self),
        .field("features", [GraphQLEnum<NotesGraphGraphQL.ServerFeature>].self),
        .field("type", GraphQLEnum<NotesGraphGraphQL.ServerDeploymentType>.self),
        .field("initialized", Bool.self),
        .field("calendarProviders", [GraphQLEnum<NotesGraphGraphQL.CalendarProviderType>].self),
        .field("credentialsRequirement", CredentialsRequirement.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        ServerConfigQuery.Data.ServerConfig.self
      ] }

      /// server version
      public var version: String { __data["version"] }
      /// server base url
      public var baseUrl: String { __data["baseUrl"] }
      /// server identical name could be shown as badge on user interface
      public var name: String { __data["name"] }
      /// enabled server features
      public var features: [GraphQLEnum<NotesGraphGraphQL.ServerFeature>] { __data["features"] }
      /// server type
      public var type: GraphQLEnum<NotesGraphGraphQL.ServerDeploymentType> { __data["type"] }
      /// whether server has been initialized
      public var initialized: Bool { __data["initialized"] }
      public var calendarProviders: [GraphQLEnum<NotesGraphGraphQL.CalendarProviderType>] { __data["calendarProviders"] }
      /// credentials requirement
      public var credentialsRequirement: CredentialsRequirement { __data["credentialsRequirement"] }

      /// ServerConfig.CredentialsRequirement
      ///
      /// Parent Type: `CredentialsRequirementType`
      public struct CredentialsRequirement: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.CredentialsRequirementType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .fragment(CredentialsRequirements.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          ServerConfigQuery.Data.ServerConfig.CredentialsRequirement.self,
          CredentialsRequirements.self
        ] }

        public var password: Password { __data["password"] }

        public struct Fragments: FragmentContainer {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public var credentialsRequirements: CredentialsRequirements { _toFragment() }
        }

        public typealias Password = CredentialsRequirements.Password
      }
    }
  }
}
