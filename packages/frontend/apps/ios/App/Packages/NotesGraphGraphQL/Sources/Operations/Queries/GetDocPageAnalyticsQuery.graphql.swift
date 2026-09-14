// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class GetDocPageAnalyticsQuery: GraphQLQuery {
  public static let operationName: String = "getDocPageAnalytics"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"query getDocPageAnalytics($workspaceId: String!, $docId: String!, $input: DocPageAnalyticsInput) { workspace(id: $workspaceId) { __typename doc(docId: $docId) { __typename analytics(input: $input) { __typename window { __typename from to timezone bucket requestedSize effectiveSize } series { __typename date totalViews uniqueViews guestViews } summary { __typename totalViews uniqueViews guestViews lastAccessedAt } generatedAt } } } }"#
    ))

  public var workspaceId: String
  public var docId: String
  public var input: GraphQLNullable<DocPageAnalyticsInput>

  public init(
    workspaceId: String,
    docId: String,
    input: GraphQLNullable<DocPageAnalyticsInput>
  ) {
    self.workspaceId = workspaceId
    self.docId = docId
    self.input = input
  }

  public var __variables: Variables? { [
    "workspaceId": workspaceId,
    "docId": docId,
    "input": input
  ] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Query }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("workspace", Workspace.self, arguments: ["id": .variable("workspaceId")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      GetDocPageAnalyticsQuery.Data.self
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
        .field("doc", Doc.self, arguments: ["docId": .variable("docId")]),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        GetDocPageAnalyticsQuery.Data.Workspace.self
      ] }

      /// Get get with given id
      public var doc: Doc { __data["doc"] }

      /// Workspace.Doc
      ///
      /// Parent Type: `DocType`
      public struct Doc: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.DocType }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("analytics", Analytics.self, arguments: ["input": .variable("input")]),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          GetDocPageAnalyticsQuery.Data.Workspace.Doc.self
        ] }

        /// Doc page analytics in a time window
        public var analytics: Analytics { __data["analytics"] }

        /// Workspace.Doc.Analytics
        ///
        /// Parent Type: `DocPageAnalytics`
        public struct Analytics: NotesGraphGraphQL.SelectionSet {
          public let __data: DataDict
          public init(_dataDict: DataDict) { __data = _dataDict }

          public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.DocPageAnalytics }
          public static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .field("window", Window.self),
            .field("series", [Series].self),
            .field("summary", Summary.self),
            .field("generatedAt", NotesGraphGraphQL.DateTime.self),
          ] }
          public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
            GetDocPageAnalyticsQuery.Data.Workspace.Doc.Analytics.self
          ] }

          public var window: Window { __data["window"] }
          public var series: [Series] { __data["series"] }
          public var summary: Summary { __data["summary"] }
          public var generatedAt: NotesGraphGraphQL.DateTime { __data["generatedAt"] }

          /// Workspace.Doc.Analytics.Window
          ///
          /// Parent Type: `TimeWindow`
          public struct Window: NotesGraphGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.TimeWindow }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("from", NotesGraphGraphQL.DateTime.self),
              .field("to", NotesGraphGraphQL.DateTime.self),
              .field("timezone", String.self),
              .field("bucket", GraphQLEnum<NotesGraphGraphQL.TimeBucket>.self),
              .field("requestedSize", Int.self),
              .field("effectiveSize", Int.self),
            ] }
            public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetDocPageAnalyticsQuery.Data.Workspace.Doc.Analytics.Window.self
            ] }

            public var from: NotesGraphGraphQL.DateTime { __data["from"] }
            public var to: NotesGraphGraphQL.DateTime { __data["to"] }
            public var timezone: String { __data["timezone"] }
            public var bucket: GraphQLEnum<NotesGraphGraphQL.TimeBucket> { __data["bucket"] }
            public var requestedSize: Int { __data["requestedSize"] }
            public var effectiveSize: Int { __data["effectiveSize"] }
          }

          /// Workspace.Doc.Analytics.Series
          ///
          /// Parent Type: `DocPageAnalyticsPoint`
          public struct Series: NotesGraphGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.DocPageAnalyticsPoint }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("date", NotesGraphGraphQL.DateTime.self),
              .field("totalViews", NotesGraphGraphQL.SafeInt.self),
              .field("uniqueViews", NotesGraphGraphQL.SafeInt.self),
              .field("guestViews", NotesGraphGraphQL.SafeInt.self),
            ] }
            public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetDocPageAnalyticsQuery.Data.Workspace.Doc.Analytics.Series.self
            ] }

            public var date: NotesGraphGraphQL.DateTime { __data["date"] }
            public var totalViews: NotesGraphGraphQL.SafeInt { __data["totalViews"] }
            public var uniqueViews: NotesGraphGraphQL.SafeInt { __data["uniqueViews"] }
            public var guestViews: NotesGraphGraphQL.SafeInt { __data["guestViews"] }
          }

          /// Workspace.Doc.Analytics.Summary
          ///
          /// Parent Type: `DocPageAnalyticsSummary`
          public struct Summary: NotesGraphGraphQL.SelectionSet {
            public let __data: DataDict
            public init(_dataDict: DataDict) { __data = _dataDict }

            public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.DocPageAnalyticsSummary }
            public static var __selections: [ApolloAPI.Selection] { [
              .field("__typename", String.self),
              .field("totalViews", NotesGraphGraphQL.SafeInt.self),
              .field("uniqueViews", NotesGraphGraphQL.SafeInt.self),
              .field("guestViews", NotesGraphGraphQL.SafeInt.self),
              .field("lastAccessedAt", NotesGraphGraphQL.DateTime?.self),
            ] }
            public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetDocPageAnalyticsQuery.Data.Workspace.Doc.Analytics.Summary.self
            ] }

            public var totalViews: NotesGraphGraphQL.SafeInt { __data["totalViews"] }
            public var uniqueViews: NotesGraphGraphQL.SafeInt { __data["uniqueViews"] }
            public var guestViews: NotesGraphGraphQL.SafeInt { __data["guestViews"] }
            public var lastAccessedAt: NotesGraphGraphQL.DateTime? { __data["lastAccessedAt"] }
          }
        }
      }
    }
  }
}
