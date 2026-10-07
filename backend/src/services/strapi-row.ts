import { randomUUID } from 'node:crypto';

/**
 * Every custom service in this backend bypasses the Document Service for
 * writes (Rule BE-2 / ADR-04) and inserts rows directly via Knex — which
 * means it must also manually populate the bookkeeping columns Strapi's
 * Document Service normally sets for every content type: `document_id`
 * (the public API identifier), and `created_at`/`updated_at`/`published_at`
 * (still required even with draftAndPublish disabled — entries are
 * immediately "published").
 */
export function strapiRowStamps() {
  const now = new Date();
  return { document_id: randomUUID(), created_at: now, updated_at: now, published_at: now };
}
