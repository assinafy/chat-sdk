/**
 * Tags resource — colored labels that can be attached to documents.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { pageQuery } from "./internal.js";
import type { CreateTagInput, ListTagsQuery, Page, Tag, UpdateTagInput } from "./types.js";

export interface DeleteTagResult { deleted: boolean }
export interface DetachTagResult { detached: boolean }

const paths = {
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/tags`,
  item: (accountId: string, tagId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/tags/${encodeURIComponent(tagId)}`,
  documentTags: (accountId: string, documentId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/documents/${encodeURIComponent(documentId)}/tags`,
  documentTag: (accountId: string, documentId: string, tagId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/documents/${encodeURIComponent(documentId)}/tags/${encodeURIComponent(tagId)}`,
};

export class TagsResource {
  constructor(private readonly http: HttpClient) {}

  /** List all tags for an account. */
  list(accountId: string, query: ListTagsQuery | string = {}): Promise<Page<Tag>> {
    const normalized = typeof query === "string" ? { search: query } : query;
    return this.http.getPage<Tag>(
      withQuery(paths.collection(accountId), {
        search: normalized.search,
        sort: normalized.sort,
        ...pageQuery(normalized.page, normalized.perPage),
      }),
    );
  }

  /** Create a new tag. */
  create(accountId: string, input: CreateTagInput): Promise<Tag> {
    return this.http.post<Tag>(paths.collection(accountId), input);
  }

  /** Update an existing tag. */
  update(accountId: string, tagId: string, input: UpdateTagInput): Promise<Tag> {
    return this.http.put<Tag>(paths.item(accountId, tagId), input);
  }

  /**
   * Delete a tag. Pass `force: true` to detach the tag from any documents
   * before deleting it; otherwise the API will refuse if it is still in use.
   */
  remove(
    accountId: string,
    tagId: string,
    options: { force?: boolean } = {},
  ): Promise<DeleteTagResult> {
    return this.http.delete<DeleteTagResult>(
      withQuery(paths.item(accountId, tagId), { force: options.force }),
    );
  }

  /** List the tags attached to a specific document. */
  listForDocument(accountId: string, documentId: string): Promise<Tag[]> {
    return this.http.get<Tag[]>(paths.documentTags(accountId, documentId));
  }

  /**
   * Replace the tags attached to a document with the given tag IDs.
   * Values are passed through unchanged.
   */
  setForDocument(accountId: string, documentId: string, tagIds: string[]): Promise<Tag[]> {
    return this.http.put<Tag[]>(paths.documentTags(accountId, documentId), { tags: tagIds });
  }

  /**
   * Add tag IDs to a document without removing existing tags.
   */
  addToDocument(accountId: string, documentId: string, tagIds: string[]): Promise<Tag[]> {
    return this.http.post<Tag[]>(paths.documentTags(accountId, documentId), { tags: tagIds });
  }

  /** Remove a single tag from a document. */
  removeFromDocument(
    accountId: string,
    documentId: string,
    tagId: string,
  ): Promise<DetachTagResult> {
    return this.http.delete<DetachTagResult>(paths.documentTag(accountId, documentId, tagId));
  }
}
