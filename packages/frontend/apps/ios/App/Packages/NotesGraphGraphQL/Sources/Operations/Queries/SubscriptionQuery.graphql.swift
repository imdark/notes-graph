// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class SubscriptionQuery: GraphQLQuery {
  public static let operationName: String = "subscription"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query subscription { currentUser { __typename id subscriptions { __typename id status plan recurring start end nextBillAt canceledAt variant } } }"#
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
      SubscriptionQuery.Data.self
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
        .field("id", NotesGraphGraphQL.ID.self),
        .field("subscriptions", [Subscription].self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        SubscriptionQuery.Data.CurrentUser.self
      ] }

      public var id: NotesGraphGraphQL.ID { __data["id"] }
      public var subscriptions: [Subscription] { __data["subscriptions"] }

      /// CurrentUser.Subscription
      ///
      /// Parent Type: `SubscriptionType`
      public struct Subscription: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.SubscriptionType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", String?.self),
          .field("status", GraphQLEnum<NotesGraphGraphQL.SubscriptionStatus>.self),
          .field("plan", GraphQLEnum<NotesGraphGraphQL.SubscriptionPlan>.self),
          .field("recurring", GraphQLEnum<NotesGraphGraphQL.SubscriptionRecurring>.self),
          .field("start", NotesGraphGraphQL.DateTime.self),
          .field("end", NotesGraphGraphQL.DateTime?.self),
          .field("nextBillAt", NotesGraphGraphQL.DateTime?.self),
          .field("canceledAt", NotesGraphGraphQL.DateTime?.self),
          .field("variant", GraphQLEnum<NotesGraphGraphQL.SubscriptionVariant>?.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          SubscriptionQuery.Data.CurrentUser.Subscription.self
        ] }

        @available(*, deprecated, message: "removed")
        public var id: String? { __data["id"] }
        public var status: GraphQLEnum<NotesGraphGraphQL.SubscriptionStatus> { __data["status"] }
        /// The 'Free' plan just exists to be a placeholder and for the type convenience of frontend.
        /// There won't actually be a subscription with plan 'Free'
        public var plan: GraphQLEnum<NotesGraphGraphQL.SubscriptionPlan> { __data["plan"] }
        public var recurring: GraphQLEnum<NotesGraphGraphQL.SubscriptionRecurring> { __data["recurring"] }
        public var start: NotesGraphGraphQL.DateTime { __data["start"] }
        public var end: NotesGraphGraphQL.DateTime? { __data["end"] }
        public var nextBillAt: NotesGraphGraphQL.DateTime? { __data["nextBillAt"] }
        public var canceledAt: NotesGraphGraphQL.DateTime? { __data["canceledAt"] }
        public var variant: GraphQLEnum<NotesGraphGraphQL.SubscriptionVariant>? { __data["variant"] }
      }
    }
  }
}
