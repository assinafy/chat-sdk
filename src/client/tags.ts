/**
 * Tags resource — colored labels that can be attached to documents.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { HttpClient, withQuery } from "./http.js";
import type { CreateTagInput, ListTagsQuery, Page, Tag, UpdateTagInput } from "./types.js";

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
        page: normalized.page,
        "per-page": normalized.perPage,
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
  async remove(accountId: string, tagId: string, options: { force?: boolean } = {}): Promise<void> {
    await this.http.delete<unknown>(withQuery(paths.item(accountId, tagId), { force: options.force }));
  }

  /** List the tags attached to a specific document. */
  listForDocument(accountId: string, documentId: string): Promise<Tag[]> {
    return this.http.get<Tag[]>(paths.documentTags(accountId, documentId));
  }

  /**
   * Replace the tags attached to a document with the given tag names.
   * Unknown names are created by the API. Tag IDs are still accepted for
   * backward compatibility where existing callers passed them.
   */
  setForDocument(accountId: string, documentId: string, tagNames: string[]): Promise<Tag[]> {
    return this.http.put<Tag[]>(paths.documentTags(accountId, documentId), { tags: tagNames });
  }

  /**
   * Add tag names to a document without removing existing tags. Unknown names
   * are created by the API.
   */
  addToDocument(accountId: string, documentId: string, tagNames: string[]): Promise<Tag[]> {
    return this.http.post<Tag[]>(paths.documentTags(accountId, documentId), { tags: tagNames });
  }

  /** Remove a single tag from a document. */
  async removeFromDocument(accountId: string, documentId: string, tagId: string): Promise<void> {
    await this.http.delete<unknown>(paths.documentTag(accountId, documentId, tagId));
  }
}
