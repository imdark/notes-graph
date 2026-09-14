export type TemplateDocSettings = {
  enablePageTemplate?: boolean;
  pageTemplateId?: string;
  journalTemplateId?: string;
  /**
   * When a new journal day is created (and no journal/page template is
   * configured), scaffold it with a section per project. Defaults to on.
   */
  journalProjectSections?: boolean;
};
