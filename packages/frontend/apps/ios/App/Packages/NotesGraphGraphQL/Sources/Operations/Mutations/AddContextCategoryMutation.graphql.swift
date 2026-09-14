// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class AddContextCategoryMutation: GraphQLMutation {
  public static let operationName: String = "addContextCategory"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"mutation addContextCategory($options: AddContextCategoryInput!) { addContextCategory(options: $options) { __typename id createdAt type docs { __typename id createdAt status } } }"#
    ))

  public var options: AddContextCategoryInput

  public init(options: AddContextCategoryInput) {
    self.options = options
  }

  public var __variables: Variables? { ["options": options] }

  public struct Data: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.Mutation }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("addContextCategory", AddContextCategory.self, arguments: ["options": .variable("options")]),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      AddContextCategoryMutation.Data.self
    ] }

    /// add a category to context
    public var addContextCategory: AddContextCategory { __data["addContextCategory"] }

    /// AddContextCategory
    ///
    /// Parent Type: `CopilotContextCategory`
    public struct AddContextCategory: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.CopilotContextCategory }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", NotesGraphGraphQL.ID.self),
        .field("createdAt", NotesGraphGraphQL.SafeInt.self),
        .field("type", GraphQLEnum<NotesGraphGraphQL.ContextCategories>.self),
        .field("docs", [Doc].self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        AddContextCategoryMutation.Data.AddContextCategory.self
      ] }

      public var id: NotesGraphGraphQL.ID { __data["id"] }
      public var createdAt: NotesGraphGraphQL.SafeInt { __data["createdAt"] }
      public var type: GraphQLEnum<NotesGraphGraphQL.ContextCategories> { __data["type"] }
      public var docs: [Doc] { __data["docs"] }

      /// AddContextCategory.Doc
      ///
      /// Parent Type: `CopilotContextDoc`
      public struct Doc: NotesGraphGraphQL.SelectionSet {
        public let __data: DataDict
        public init(_dataDict: DataDict) { __data = _dataDict }

        public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.CopilotContextDoc }
        public static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("id", NotesGraphGraphQL.ID.self),
          .field("createdAt", NotesGraphGraphQL.SafeInt.self),
          .field("status", GraphQLEnum<NotesGraphGraphQL.ContextEmbedStatus>?.self),
        ] }
        public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          AddContextCategoryMutation.Data.AddContextCategory.Doc.self
        ] }

        public var id: NotesGraphGraphQL.ID { __data["id"] }
        public var createdAt: NotesGraphGraphQL.SafeInt { __data["createdAt"] }
        public var status: GraphQLEnum<NotesGraphGraphQL.ContextEmbedStatus>? { __data["status"] }
      }
    }
  }
}
