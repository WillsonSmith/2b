// Local mirror of the server's style-guide contract
// (packages/app-episteme/src/plugins/style-guide/types.ts). Kept here so the
// feature owns its own API shapes per the components convention.

export interface StyleSection {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
  order: number;
}

export interface StyleBudget {
  used: number;
  cap: number;
  droppedSectionIds: string[];
}

export interface StyleGuideResponse {
  sections: StyleSection[];
  budget: StyleBudget;
}

export interface LibraryItem {
  slug: string;
  title: string;
  preview: string;
}
