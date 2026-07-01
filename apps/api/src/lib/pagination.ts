/**
 * Pagination helpers — shared by list endpoints that want a stable
 * `{ items, nextCursor, total }` shape without each route reinventing
 * the slicing/cursor logic.
 *
 * Cursor semantics: the cursor is the *id* (or sortable string) of the
 * last item in the current page. The next call passes it back as
 * `?cursor=<id>` and we resume at the position immediately after.
 *
 * `paginate` accepts the full list plus the query and returns the page
 * slice + a `nextCursor` only when more rows remain. `PaginationQuerySchema`
 * is the zod schema every list endpoint can re-use for its `request.query`.
 */

import { z } from "zod";

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | undefined;
  total: number;
}

/**
 * Slice `items` (already in stable order) into a page. `cursor` is the id
 * of the last item of the previous page; we resume at the next position.
 *
 * `getId` defaults to `String(item)` — fine for primitive arrays. For
 * object arrays pass a function that returns the stable id field.
 */
export function paginate<T>(
  items: T[],
  query: PaginationQuery,
  getId: (item: T) => string = (item) => String(item),
): PaginatedResult<T> {
  const limit = query.limit;
  let startIdx = 0;

  if (query.cursor) {
    const cursorIdx = items.findIndex((item) => getId(item) === query.cursor);
    if (cursorIdx < 0) {
      // Cursor refers to an item that no longer exists — treat as page 0
      // rather than erroring, so a stale client doesn't get stuck.
      startIdx = 0;
    } else {
      startIdx = cursorIdx + 1;
    }
  }

  const slice = items.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < items.length;
  const nextCursor = hasMore && slice.length > 0 ? getId(slice[slice.length - 1]!) : undefined;

  return {
    items: slice,
    nextCursor,
    total: items.length,
  };
}
