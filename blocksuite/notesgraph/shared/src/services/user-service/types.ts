export type RemovedUserInfo = {
  id: string;
  removed: true;
};

export type ExistedUserInfo = {
  id: string;
  name?: string | null;
  avatar?: string | null;
  removed?: false;
};

export type NotesGraphUserInfo = RemovedUserInfo | ExistedUserInfo;

export function isRemovedUserInfo(
  userInfo: NotesGraphUserInfo
): userInfo is RemovedUserInfo {
  return Boolean('removed' in userInfo && userInfo.removed);
}

export function isExistedUserInfo(
  userInfo: NotesGraphUserInfo
): userInfo is ExistedUserInfo {
  return !isRemovedUserInfo(userInfo);
}
