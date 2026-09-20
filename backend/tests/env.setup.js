// Jest's setupFiles run before any test file (and its requires) execute, so
// app.js's require-time JWT_SECRET check always passes during tests.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-do-not-use-in-production";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
