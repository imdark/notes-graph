// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

public protocol SelectionSet: ApolloAPI.SelectionSet & ApolloAPI.RootSelectionSet
where Schema == NotesGraphGraphQL.SchemaMetadata {}

public protocol InlineFragment: ApolloAPI.SelectionSet & ApolloAPI.InlineFragment
where Schema == NotesGraphGraphQL.SchemaMetadata {}

public protocol MutableSelectionSet: ApolloAPI.MutableRootSelectionSet
where Schema == NotesGraphGraphQL.SchemaMetadata {}

public protocol MutableInlineFragment: ApolloAPI.MutableSelectionSet & ApolloAPI.InlineFragment
where Schema == NotesGraphGraphQL.SchemaMetadata {}

public enum SchemaMetadata: ApolloAPI.SchemaMetadata {
  public static let configuration: any ApolloAPI.SchemaConfiguration.Type = SchemaConfiguration.self

  private static let objectTypeMap: [String: ApolloAPI.Object] = [
    "AdminAllSharedLink": NotesGraphGraphQL.Objects.AdminAllSharedLink,
    "AdminAllSharedLinkEdge": NotesGraphGraphQL.Objects.AdminAllSharedLinkEdge,
    "AdminDashboard": NotesGraphGraphQL.Objects.AdminDashboard,
    "AdminDashboardMinutePoint": NotesGraphGraphQL.Objects.AdminDashboardMinutePoint,
    "AdminDashboardValueDayPoint": NotesGraphGraphQL.Objects.AdminDashboardValueDayPoint,
    "AdminLicensePreview": NotesGraphGraphQL.Objects.AdminLicensePreview,
    "AdminSharedLinkTopItem": NotesGraphGraphQL.Objects.AdminSharedLinkTopItem,
    "AdminWorkspace": NotesGraphGraphQL.Objects.AdminWorkspace,
    "AdminWorkspaceMember": NotesGraphGraphQL.Objects.AdminWorkspaceMember,
    "AdminWorkspaceSharedLink": NotesGraphGraphQL.Objects.AdminWorkspaceSharedLink,
    "AggregateBucketHitsObjectType": NotesGraphGraphQL.Objects.AggregateBucketHitsObjectType,
    "AggregateBucketObjectType": NotesGraphGraphQL.Objects.AggregateBucketObjectType,
    "AggregateResultObjectType": NotesGraphGraphQL.Objects.AggregateResultObjectType,
    "AppConfigValidateResult": NotesGraphGraphQL.Objects.AppConfigValidateResult,
    "AudioSliceManifestItemType": NotesGraphGraphQL.Objects.AudioSliceManifestItemType,
    "BlobUploadInit": NotesGraphGraphQL.Objects.BlobUploadInit,
    "BlobUploadPart": NotesGraphGraphQL.Objects.BlobUploadPart,
    "BlobUploadedPart": NotesGraphGraphQL.Objects.BlobUploadedPart,
    "CalendarAccountObjectType": NotesGraphGraphQL.Objects.CalendarAccountObjectType,
    "CalendarCalDAVProviderPresetObjectType": NotesGraphGraphQL.Objects.CalendarCalDAVProviderPresetObjectType,
    "CalendarEventObjectType": NotesGraphGraphQL.Objects.CalendarEventObjectType,
    "CalendarSubscriptionObjectType": NotesGraphGraphQL.Objects.CalendarSubscriptionObjectType,
    "ChatMessage": NotesGraphGraphQL.Objects.ChatMessage,
    "CommentChangeObjectType": NotesGraphGraphQL.Objects.CommentChangeObjectType,
    "CommentChangeObjectTypeEdge": NotesGraphGraphQL.Objects.CommentChangeObjectTypeEdge,
    "CommentObjectType": NotesGraphGraphQL.Objects.CommentObjectType,
    "CommentObjectTypeEdge": NotesGraphGraphQL.Objects.CommentObjectTypeEdge,
    "ContextMatchedDocChunk": NotesGraphGraphQL.Objects.ContextMatchedDocChunk,
    "ContextMatchedFileChunk": NotesGraphGraphQL.Objects.ContextMatchedFileChunk,
    "Copilot": NotesGraphGraphQL.Objects.Copilot,
    "CopilotContext": NotesGraphGraphQL.Objects.CopilotContext,
    "CopilotContextBlob": NotesGraphGraphQL.Objects.CopilotContextBlob,
    "CopilotContextCategory": NotesGraphGraphQL.Objects.CopilotContextCategory,
    "CopilotContextDoc": NotesGraphGraphQL.Objects.CopilotContextDoc,
    "CopilotContextFile": NotesGraphGraphQL.Objects.CopilotContextFile,
    "CopilotHistories": NotesGraphGraphQL.Objects.CopilotHistories,
    "CopilotHistoriesTypeEdge": NotesGraphGraphQL.Objects.CopilotHistoriesTypeEdge,
    "CopilotModelType": NotesGraphGraphQL.Objects.CopilotModelType,
    "CopilotModelsType": NotesGraphGraphQL.Objects.CopilotModelsType,
    "CopilotQuota": NotesGraphGraphQL.Objects.CopilotQuota,
    "CopilotWorkspaceConfig": NotesGraphGraphQL.Objects.CopilotWorkspaceConfig,
    "CopilotWorkspaceFile": NotesGraphGraphQL.Objects.CopilotWorkspaceFile,
    "CopilotWorkspaceFileTypeEdge": NotesGraphGraphQL.Objects.CopilotWorkspaceFileTypeEdge,
    "CopilotWorkspaceIgnoredDoc": NotesGraphGraphQL.Objects.CopilotWorkspaceIgnoredDoc,
    "CopilotWorkspaceIgnoredDocTypeEdge": NotesGraphGraphQL.Objects.CopilotWorkspaceIgnoredDocTypeEdge,
    "CreateWorkspaceByokLocalLeaseResultType": NotesGraphGraphQL.Objects.CreateWorkspaceByokLocalLeaseResultType,
    "CredentialsRequirementType": NotesGraphGraphQL.Objects.CredentialsRequirementType,
    "DeleteAccount": NotesGraphGraphQL.Objects.DeleteAccount,
    "DocHistoryType": NotesGraphGraphQL.Objects.DocHistoryType,
    "DocMemberLastAccess": NotesGraphGraphQL.Objects.DocMemberLastAccess,
    "DocMemberLastAccessEdge": NotesGraphGraphQL.Objects.DocMemberLastAccessEdge,
    "DocPageAnalytics": NotesGraphGraphQL.Objects.DocPageAnalytics,
    "DocPageAnalyticsPoint": NotesGraphGraphQL.Objects.DocPageAnalyticsPoint,
    "DocPageAnalyticsSummary": NotesGraphGraphQL.Objects.DocPageAnalyticsSummary,
    "DocPermissions": NotesGraphGraphQL.Objects.DocPermissions,
    "DocType": NotesGraphGraphQL.Objects.DocType,
    "DocTypeEdge": NotesGraphGraphQL.Objects.DocTypeEdge,
    "EditorType": NotesGraphGraphQL.Objects.EditorType,
    "InvitationType": NotesGraphGraphQL.Objects.InvitationType,
    "InvitationWorkspaceType": NotesGraphGraphQL.Objects.InvitationWorkspaceType,
    "InviteLink": NotesGraphGraphQL.Objects.InviteLink,
    "InviteResult": NotesGraphGraphQL.Objects.InviteResult,
    "InvoiceType": NotesGraphGraphQL.Objects.InvoiceType,
    "License": NotesGraphGraphQL.Objects.License,
    "LimitedUserType": NotesGraphGraphQL.Objects.LimitedUserType,
    "ListedBlob": NotesGraphGraphQL.Objects.ListedBlob,
    "MeetingActionItemType": NotesGraphGraphQL.Objects.MeetingActionItemType,
    "MeetingSummaryV2Type": NotesGraphGraphQL.Objects.MeetingSummaryV2Type,
    "Mutation": NotesGraphGraphQL.Objects.Mutation,
    "NormalizedTranscriptSegmentType": NotesGraphGraphQL.Objects.NormalizedTranscriptSegmentType,
    "NotificationObjectType": NotesGraphGraphQL.Objects.NotificationObjectType,
    "NotificationObjectTypeEdge": NotesGraphGraphQL.Objects.NotificationObjectTypeEdge,
    "PageInfo": NotesGraphGraphQL.Objects.PageInfo,
    "PaginatedAdminAllSharedLink": NotesGraphGraphQL.Objects.PaginatedAdminAllSharedLink,
    "PaginatedCommentChangeObjectType": NotesGraphGraphQL.Objects.PaginatedCommentChangeObjectType,
    "PaginatedCommentObjectType": NotesGraphGraphQL.Objects.PaginatedCommentObjectType,
    "PaginatedCopilotHistoriesType": NotesGraphGraphQL.Objects.PaginatedCopilotHistoriesType,
    "PaginatedCopilotWorkspaceFileType": NotesGraphGraphQL.Objects.PaginatedCopilotWorkspaceFileType,
    "PaginatedDocMemberLastAccess": NotesGraphGraphQL.Objects.PaginatedDocMemberLastAccess,
    "PaginatedDocType": NotesGraphGraphQL.Objects.PaginatedDocType,
    "PaginatedIgnoredDocsType": NotesGraphGraphQL.Objects.PaginatedIgnoredDocsType,
    "PaginatedNotificationObjectType": NotesGraphGraphQL.Objects.PaginatedNotificationObjectType,
    "PasswordLimitsType": NotesGraphGraphQL.Objects.PasswordLimitsType,
    "PublicUserType": NotesGraphGraphQL.Objects.PublicUserType,
    "Query": NotesGraphGraphQL.Objects.Query,
    "ReleaseVersionType": NotesGraphGraphQL.Objects.ReleaseVersionType,
    "RemoveAvatar": NotesGraphGraphQL.Objects.RemoveAvatar,
    "ReplyObjectType": NotesGraphGraphQL.Objects.ReplyObjectType,
    "RevealedAccessToken": NotesGraphGraphQL.Objects.RevealedAccessToken,
    "SearchDocObjectType": NotesGraphGraphQL.Objects.SearchDocObjectType,
    "SearchNodeObjectType": NotesGraphGraphQL.Objects.SearchNodeObjectType,
    "SearchResultObjectType": NotesGraphGraphQL.Objects.SearchResultObjectType,
    "SearchResultPagination": NotesGraphGraphQL.Objects.SearchResultPagination,
    "ServerConfigType": NotesGraphGraphQL.Objects.ServerConfigType,
    "StreamObject": NotesGraphGraphQL.Objects.StreamObject,
    "SubscriptionPrice": NotesGraphGraphQL.Objects.SubscriptionPrice,
    "SubscriptionType": NotesGraphGraphQL.Objects.SubscriptionType,
    "TestWorkspaceByokConfigResultType": NotesGraphGraphQL.Objects.TestWorkspaceByokConfigResultType,
    "TimeWindow": NotesGraphGraphQL.Objects.TimeWindow,
    "TranscriptionItemType": NotesGraphGraphQL.Objects.TranscriptionItemType,
    "TranscriptionQualityType": NotesGraphGraphQL.Objects.TranscriptionQualityType,
    "TranscriptionResultType": NotesGraphGraphQL.Objects.TranscriptionResultType,
    "TranscriptionSourceAudioType": NotesGraphGraphQL.Objects.TranscriptionSourceAudioType,
    "UserImportFailedType": NotesGraphGraphQL.Objects.UserImportFailedType,
    "UserQuotaHumanReadableType": NotesGraphGraphQL.Objects.UserQuotaHumanReadableType,
    "UserQuotaType": NotesGraphGraphQL.Objects.UserQuotaType,
    "UserQuotaUsageType": NotesGraphGraphQL.Objects.UserQuotaUsageType,
    "UserSettingsType": NotesGraphGraphQL.Objects.UserSettingsType,
    "UserType": NotesGraphGraphQL.Objects.UserType,
    "WorkspaceByokCapabilityWarningType": NotesGraphGraphQL.Objects.WorkspaceByokCapabilityWarningType,
    "WorkspaceByokKeyConfigType": NotesGraphGraphQL.Objects.WorkspaceByokKeyConfigType,
    "WorkspaceByokSettingsType": NotesGraphGraphQL.Objects.WorkspaceByokSettingsType,
    "WorkspaceByokUsagePointType": NotesGraphGraphQL.Objects.WorkspaceByokUsagePointType,
    "WorkspaceCalendarItemObjectType": NotesGraphGraphQL.Objects.WorkspaceCalendarItemObjectType,
    "WorkspaceCalendarObjectType": NotesGraphGraphQL.Objects.WorkspaceCalendarObjectType,
    "WorkspaceDocMeta": NotesGraphGraphQL.Objects.WorkspaceDocMeta,
    "WorkspacePermissions": NotesGraphGraphQL.Objects.WorkspacePermissions,
    "WorkspaceQuotaHumanReadableType": NotesGraphGraphQL.Objects.WorkspaceQuotaHumanReadableType,
    "WorkspaceQuotaType": NotesGraphGraphQL.Objects.WorkspaceQuotaType,
    "WorkspaceRolePermissions": NotesGraphGraphQL.Objects.WorkspaceRolePermissions,
    "WorkspaceType": NotesGraphGraphQL.Objects.WorkspaceType,
    "WorkspaceUserType": NotesGraphGraphQL.Objects.WorkspaceUserType,
    "tokenType": NotesGraphGraphQL.Objects.TokenType
  ]

  public static func objectType(forTypename typename: String) -> ApolloAPI.Object? {
    objectTypeMap[typename]
  }
}

public enum Objects {}
public enum Interfaces {}
public enum Unions {}
