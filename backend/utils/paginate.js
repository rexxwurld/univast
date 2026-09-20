const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parses ?page=&limit= from a request into safe, bounded values, and returns
 * a helper to shape the final response consistently.
 *
 * Usage:
 *   const { skip, limit, page } = parsePagination(req.query);
 *   const [items, total] = await Promise.all([
 *     Model.find(filter).skip(skip).limit(limit),
 *     Model.countDocuments(filter),
 *   ]);
 *   res.json(buildPaginatedResponse(items, total, page, limit));
 */
function parsePagination(query = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  return { page, limit, skip: (page - 1) * limit };
}

function buildPaginatedResponse(items, total, page, limit) {
  return {
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      hasNextPage: page * limit < total,
    },
  };
}

module.exports = { parsePagination, buildPaginatedResponse };
