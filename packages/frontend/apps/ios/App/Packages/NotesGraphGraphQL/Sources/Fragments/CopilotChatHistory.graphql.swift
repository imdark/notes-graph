// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public struct CopilotChatHistory: NotesGraphGraphQL.SelectionSet, Fragment {
  public static var fragmentDefinition: StaticString {
    #"fragment CopilotChatHistory on CopilotHistories { __typename sessionId workspaceId docId parentSessionId promptName model optionalModels action pinned title tokens messages { __typename id role content attachments streamObjects { __typename type textDelta toolCallId toolName args result } createdAt } createdAt updatedAt }"#
  }

  public let __data: DataDict
  public init(_dataDict: DataDict) { __data = _dataDict }

  public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.CopilotHistories }
  public static var __selections: [ApolloAPI.Selection] { [
    .field("__typename", String.self),
    .field("sessionId", String.self),
    .field("workspaceId", String.self),
    .field("docId", String?.self),
    .field("parentSessionId", String?.self),
    .field("promptName", String.self),
    .field("model", String.self),
    .field("optionalModels", [String].self),
    .field("action", String?.self),
    .field("pinned", Bool.self),
    .field("title", String?.self),
    .field("tokens", Int.self),
    .field("messages", [Message].self),
    .field("createdAt", NotesGraphGraphQL.DateTime.self),
    .field("updatedAt", NotesGraphGraphQL.DateTime.self),
  ] }
  public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
    CopilotChatHistory.self
  ] }

  public var sessionId: String { __data["sessionId"] }
  public var workspaceId: String { __data["workspaceId"] }
  public var docId: String? { __data["docId"] }
  public var parentSessionId: String? { __data["parentSessionId"] }
  public var promptName: String { __data["promptName"] }
  public var model: String { __data["model"] }
  public var optionalModels: [String] { __data["optionalModels"] }
  /// An mark identifying which view to use to display the session
  public var action: String? { __data["action"] }
  public var pinned: Bool { __data["pinned"] }
  public var title: String? { __data["title"] }
  /// The number of tokens used in the session
  public var tokens: Int { __data["tokens"] }
  public var messages: [Message] { __data["messages"] }
  public var createdAt: NotesGraphGraphQL.DateTime { __data["createdAt"] }
  public var updatedAt: NotesGraphGraphQL.DateTime { __data["updatedAt"] }

  /// Message
  ///
  /// Parent Type: `ChatMessage`
  public struct Message: NotesGraphGraphQL.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.ChatMessage }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", NotesGraphGraphQL.ID?.self),
      .field("role", String.self),
      .field("content", String.self),
      .field("attachments", [String]?.self),
      .field("streamObjects", [StreamObject]?.self),
      .field("createdAt", NotesGraphGraphQL.DateTime.self),
    ] }
    public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      CopilotChatHistory.Message.self
    ] }

    public var id: NotesGraphGraphQL.ID? { __data["id"] }
    public var role: String { __data["role"] }
    public var content: String { __data["content"] }
    public var attachments: [String]? { __data["attachments"] }
    public var streamObjects: [StreamObject]? { __data["streamObjects"] }
    public var createdAt: NotesGraphGraphQL.DateTime { __data["createdAt"] }

    /// Message.StreamObject
    ///
    /// Parent Type: `StreamObject`
    public struct StreamObject: NotesGraphGraphQL.SelectionSet {
      public let __data: DataDict
      public init(_dataDict: DataDict) { __data = _dataDict }

      public static var __parentType: any ApolloAPI.ParentType { NotesGraphGraphQL.Objects.StreamObject }
      public static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("type", String.self),
        .field("textDelta", String?.self),
        .field("toolCallId", String?.self),
        .field("toolName", String?.self),
        .field("args", NotesGraphGraphQL.JSON?.self),
        .field("result", NotesGraphGraphQL.JSON?.self),
      ] }
      public static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        CopilotChatHistory.Message.StreamObject.self
      ] }

      public var type: String { __data["type"] }
      public var textDelta: String? { __data["textDelta"] }
      public var toolCallId: String? { __data["toolCallId"] }
      public var toolName: String? { __data["toolName"] }
      public var args: NotesGraphGraphQL.JSON? { __data["args"] }
      public var result: NotesGraphGraphQL.JSON? { __data["result"] }
    }
  }
}
