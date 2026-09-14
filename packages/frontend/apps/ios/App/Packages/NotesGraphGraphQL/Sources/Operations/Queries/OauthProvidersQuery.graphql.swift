// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class OauthProvidersQuery: GraphQLQuery {
  public static let operationName: String = "oauthProviders"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query oauthProviders { serverConfig { __typename oauthProviders } }"#
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
      OauthProvidersQuery.Data.self
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
        .field("oauthProviders", [GraphQLEnum<NotesGraphGraphQL.OAuthProviderType>].self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        OauthProvidersQuery.Data.ServerConfig.self
      ] }

      public var oauthProviders: [GraphQLEnum<NotesGraphGraphQL.OAuthProviderType>] { __data["oauthProviders"] }
    }
  }
}
