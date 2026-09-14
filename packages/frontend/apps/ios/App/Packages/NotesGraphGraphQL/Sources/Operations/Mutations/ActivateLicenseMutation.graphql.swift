// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ActivateLicenseMutation: GraphQLMutation {
  public static let operationName: String = "activateLicense"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation activateLicense($workspaceId: String!, $license: String!) { activateLicense(workspaceId: $workspaceId, license: $license) { __typename ...licenseBody } }"#,
      fragments: [LicenseBody.self]
    ))

  public var workspaceId: String
  public var license: String

  public init(
    workspaceId: String,
    license: String
  ) {
    self.workspaceId = workspaceId
    self.license = license
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "license": license
  ] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("activateLicense", ActivateLicense.self, arguments: [
        "workspaceId": .variable("workspaceId"),
        "license": .variable("license")
      ]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      ActivateLicenseMutation.Data.self
    ] }

    public var activateLicense: ActivateLicense { __data["activateLicense"] }

    /// ActivateLicense
    ///
    /// Parent Type: `License`
    public struct ActivateLicense: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.License }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .fragment(LicenseBody.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        ActivateLicenseMutation.Data.ActivateLicense.self,
        LicenseBody.self
      ] }

      public var expiredAt: NotesGraphGraphQL.DateTime? { __data["expiredAt"] }
      public var installedAt: NotesGraphGraphQL.DateTime { __data["installedAt"] }
      public var quantity: Int { __data["quantity"] }
      public var recurring: GraphQLEnum<NotesGraphGraphQL.SubscriptionRecurring> { __data["recurring"] }
      public var validatedAt: NotesGraphGraphQL.DateTime { __data["validatedAt"] }
      public var variant: GraphQLEnum<NotesGraphGraphQL.SubscriptionVariant>? { __data["variant"] }

      public struct Fragments: FragmentContainer {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public var licenseBody: LicenseBody { _toFragment() }
      }
    }
  }
}
