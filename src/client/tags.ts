/**
 * Tags resource — colored labels that can be attached to documents.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { pageQuery } from "./internal.js";
import type { CreateTagInput, ListTagsQuery, Page, Tag, UpdateTagInput } from "./types.js";

/** `DELETE /accounts/{accountId}/tags/{tagId}` response. */
export interface DeleteTagResult { deleted: boolean }
/** `DELETE /accounts/{accountId}/documents/{documentId}/tags/{tagId}` response. */
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

/** Workspace tags and their attachment to documents (`client.tags`). Document-tag operations take tag ids. */
export class TagsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /accounts/{accountId}/tags` — query `search` (a string argument is
   * shorthand for it), `sort`, `page`, `per-page`. Response: `Page<Tag>`
   * (`{ resource, id, name, color, created_at, updated_at }`).
   */
  async list(accountId: string, query: ListTagsQuery | string = {}): Promise<Page<Tag>> {
    const normalized = typeof query === "string" ? { search: query } : query;
    return this.http.getPage<Tag>(
      withQuery(paths.collection(accountId), {
        search: normalized.search,
        sort: normalized.sort,
        ...pageQuery(normalized.page, normalized.perPage),
      }),
    );
  }

  /** `POST /accounts/{accountId}/tags` — request `{ name, color? }`; response: the new {@link Tag}. */
  async create(accountId: string, input: CreateTagInput): Promise<Tag> {
    const { name, color } = input;
    return this.http.post<Tag>(paths.collection(accountId), { name, color });
  }

  /** `PUT /accounts/{accountId}/tags/{tagId}` — request `{ name?, color? }`; response: the {@link Tag}. */
  async update(accountId: string, tagId: string, input: UpdateTagInput): Promise<Tag> {
    const { name, color } = input;
    return this.http.put<Tag>(paths.item(accountId, tagId), { name, color });
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

  /** `GET /accounts/{accountId}/documents/{documentId}/tags` — the document's {@link Tag}s. */
  listForDocument(accountId: string, documentId: string): Promise<Tag[]> {
    return this.http.get<Tag[]>(paths.documentTags(accountId, documentId));
  }

  /**
   * `PUT /accounts/{accountId}/documents/{documentId}/tags` — replace the
   * document's tags. Request `{ tags: tagIds }`; response: the resulting {@link Tag}s.
   */
  setForDocument(accountId: string, documentId: string, tagIds: string[]): Promise<Tag[]> {
    return this.http.put<Tag[]>(paths.documentTags(accountId, documentId), { tags: tagIds });
  }

  /**
   * `POST /accounts/{accountId}/documents/{documentId}/tags` — attach tags
   * without removing existing ones. Request `{ tags: tagIds }`; response: the
   * document's {@link Tag}s.
   */
  addToDocument(accountId: string, documentId: string, tagIds: string[]): Promise<Tag[]> {
    return this.http.post<Tag[]>(paths.documentTags(accountId, documentId), { tags: tagIds });
  }

  /** `DELETE /accounts/{accountId}/documents/{documentId}/tags/{tagId}` — response `{ detached }`. */
  removeFromDocument(
    accountId: string,
    documentId: string,
    tagId: string,
  ): Promise<DetachTagResult> {
    return this.http.delete<DetachTagResult>(paths.documentTag(accountId, documentId, tagId));
  }
}
