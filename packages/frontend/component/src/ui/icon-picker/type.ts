export enum IconType {
  Emoji = 'emoji',
  NotesGraphIcon = 'notesgraph-icon',
  Blob = 'blob',
}

export type IconData =
  | {
      type: IconType.Emoji;
      unicode: string;
    }
  | {
      type: IconType.NotesGraphIcon;
      name: string;
      color: string;
    }
  | {
      type: IconType.Blob;
      /**
       * Self-contained data: URL (small raster icons, e.g. AI-generated).
       * A string so the icon serializes into the workspace DB and syncs the
       * same way emoji icons do.
       */
      url: string;
    };
