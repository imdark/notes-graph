// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public struct LicenseBody: NotesGraphGraphQL.SelectionSet, Fragment {
  public static var fragmentDefinition: StaticString {
    #"fragment licenseBody on License { __typename expiredAt installedAt quantity recurring validatedAt variant }"#
  }

  public let __data: DataDict
  public init(_dataDict: DataDict) { __data = _dataDict }

  public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.License }
  public static var __selections: [ApolloAPI.Selection] { [
    .field("__typename", String.self),
    .field("expiredAt", NotesGraphGraphQL.DateTime?.self),
    .field("installedAt", NotesGraphGraphQL.DateTime.self),
    .field("quantity", Int.self),
    .field("recurring", GraphQLEnum<NotesGraphGraphQL.SubscriptionRecurring>.self),
    .field("validatedAt", NotesGraphGraphQL.DateTime.self),
    .field("variant", GraphQLEnum<NotesGraphGraphQL.SubscriptionVariant>?.self),
  ] }
  public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
    LicenseBody.self
  ] }

  public var expiredAt: NotesGraphGraphQL.DateTime? { __data["expiredAt"] }
  public var installedAt: NotesGraphGraphQL.DateTime { __data["installedAt"] }
  public var quantity: Int { __data["quantity"] }
  public var recurring: GraphQLEnum<NotesGraphGraphQL.SubscriptionRecurring> { __data["recurring"] }
  public var validatedAt: NotesGraphGraphQL.DateTime { __data["validatedAt"] }
  public var variant: GraphQLEnum<NotesGraphGraphQL.SubscriptionVariant>? { __data["variant"] }
}
