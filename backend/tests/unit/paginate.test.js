const { parsePagination, buildPaginatedResponse } = require("../../utils/paginate");

describe("parsePagination", () => {
  it("defaults to page 1, limit 20", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination()).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("computes skip from page and limit", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it("caps limit at 100", () => {
    expect(parsePagination({ limit: "5000" }).limit).toBe(100);
  });

  it("falls back to defaults for garbage or non-positive input", () => {
    expect(parsePagination({ page: "abc", limit: "-4" })).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination({ page: "0", limit: "0" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });
});

describe("buildPaginatedResponse", () => {
  it("reports totals and hasNextPage", () => {
    const res = buildPaginatedResponse([1, 2], 45, 1, 20);
    expect(res.data).toEqual([1, 2]);
    expect(res.pagination).toEqual({ page: 1, limit: 20, total: 45, totalPages: 3, hasNextPage: true });
  });

  it("has no next page on the last page", () => {
    expect(buildPaginatedResponse([], 45, 3, 20).pagination.hasNextPage).toBe(false);
  });

  it("handles an empty result set", () => {
    expect(buildPaginatedResponse([], 0, 1, 20).pagination).toMatchObject({ total: 0, totalPages: 0, hasNextPage: false });
  });
});
