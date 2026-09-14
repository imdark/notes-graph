// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class ResumeSubscriptionMutation: GraphQLMutation {
  public static let operationName: String = "resumeSubscription"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation resumeSubscription($plan: SubscriptionPlan = Pro, $workspaceId: String) { resumeSubscription(plan: $plan, workspaceId: $workspaceId) { __typename id status nextBillAt start end } }"#
    ))

  public var plan: GraphQLNullable<GraphQLEnum<SubscriptionPlan>>
  public var workspaceId: GraphQLNullable<String>

  public init(
    plan: GraphQLNullable<GraphQLEnum<SubscriptionPlan>> = .init(.pro),
    workspaceId: GraphQLNullable<String>
  ) {
    self.plan = plan
    self.workspaceId = workspaceId
  }

  public var __variables: Variables? { [
    "plan": plan,
    "workspaceId": workspaceId
  ] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("resumeSubscription", ResumeSubscription.self, arguments: [
        "plan": .variable("plan"),
        "workspaceId": .variable("workspaceId")
      ]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      ResumeSubscriptionMutation.Data.self
    ] }

    public var resumeSubscription: ResumeSubscription { __data["resumeSubscription"] }

    /// ResumeSubscription
    ///
    /// Parent Type: `SubscriptionType`
    public struct ResumeSubscription: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.SubscriptionType }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", String?.self),
        .field("status", GraphQLEnum<NotesGraphGraphQL.SubscriptionStatus>.self),
        .field("nextBillAt", NotesGraphGraphQL.DateTime?.self),
        .field("start", NotesGraphGraphQL.DateTime.self),
        .field("end", NotesGraphGraphQL.DateTime?.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        ResumeSubscriptionMutation.Data.ResumeSubscription.self
      ] }

      @available(*, deprecated, message: "removed")
      public var id: String? { __data["id"] }
      public var status: GraphQLEnum<NotesGraphGraphQL.SubscriptionStatus> { __data["status"] }
      public var nextBillAt: NotesGraphGraphQL.DateTime? { __data["nextBillAt"] }
      public var start: NotesGraphGraphQL.DateTime { __data["start"] }
      public var end: NotesGraphGraphQL.DateTime? { __data["end"] }
    }
  }
}
