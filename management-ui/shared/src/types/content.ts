export interface ContentDraft {
  id: number;
  documentId: string;
  contentType: string;
  title: string;
  slug?: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}
