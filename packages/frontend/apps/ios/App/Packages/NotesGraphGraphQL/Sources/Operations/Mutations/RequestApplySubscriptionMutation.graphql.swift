// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class RequestApplySubscriptionMutation: GraphQLMutation {
  public static let operationName: String = "requestApplySubscription"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation requestApplySubscription($transactionId: String!) { requestApplySubscription(transactionId: $transactionId) { __typename id status plan recurring start end nextBillAt canceledAt variant } }"#
    ))

  public var transactionId: String

  public init(transactionId: String) {
    self.transactionId = transactionId
  }

  public var __variables: Variables? { ["transactionId": transactionId] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("requestApplySubscription", [RequestApplySubscription].self, arguments: ["transactionId": .variable("transactionId")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      RequestApplySubscriptionMutation.Data.self
    ] }

    /// Request to apply the subscription in advance
    public var requestApplySubscription: [RequestApplySubscription] { __data["requestApplySubscription"] }

    /// RequestApplySubscription
    ///
    /// Parent Type: `SubscriptionType`
    public struct RequestApplySubscription: NotesGraphGraphQL.SelectionSet {
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
        RequestApplySubscriptionMutation.Data.RequestApplySubscription.self
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
