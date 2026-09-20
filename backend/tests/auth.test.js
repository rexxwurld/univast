const request = require("supertest");
const app = require("../app");
const { connect, closeDatabase, clearDatabase } = require("./testDb");

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Auth", () => {
  const validUser = { name: "Test User", email: "test@example.com", password: "password123" };

  it("registers a new user and returns a token", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(validUser);

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user.role).toBe("user");
  });

  it("rejects registration with a too-short password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...validUser, password: "short" });

    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    await request(app).post("/api/v1/auth/register").send(validUser);
    const res = await request(app).post("/api/v1/auth/register").send(validUser);

    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials", async () => {
    await request(app).post("/api/v1/auth/register").send(validUser);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it("rejects the wrong password with a generic message (no user enumeration)", async () => {
    await request(app).post("/api/v1/auth/register").send(validUser);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: validUser.email, password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("rejects a nonexistent email with the exact same generic message", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("rejects /me with no token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user for /me with a valid token", async () => {
    const registerRes = await request(app).post("/api/v1/auth/register").send(validUser);

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registerRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(validUser.email);
  });

  describe("refresh tokens", () => {
    it("returns a refresh token on register and login", async () => {
      const reg = await request(app).post("/api/v1/auth/register").send(validUser);
      expect(reg.body.refreshToken).toBeDefined();

      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: validUser.email, password: validUser.password });
      expect(login.body.refreshToken).toBeDefined();
    });

    it("exchanges a refresh token for a new pair and rejects the old one (rotation)", async () => {
      const reg = await request(app).post("/api/v1/auth/register").send(validUser);
      const oldRefresh = reg.body.refreshToken;

      const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: oldRefresh });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(oldRefresh);

      const reuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: oldRefresh });
      expect(reuse.status).toBe(401);

      // The new access token actually works.
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
    });

    it("rejects an unknown refresh token", async () => {
      const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "not-a-real-token" });
      expect(res.status).toBe(401);
    });

    it("rejects a refresh request with no token", async () => {
      const res = await request(app).post("/api/v1/auth/refresh").send({});
      expect(res.status).toBe(400);
    });

    it("logout revokes the refresh token", async () => {
      const reg = await request(app).post("/api/v1/auth/register").send(validUser);

      const out = await request(app).post("/api/v1/auth/logout").send({ refreshToken: reg.body.refreshToken });
      expect(out.status).toBe(204);

      const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: reg.body.refreshToken });
      expect(res.status).toBe(401);
    });

    it("logout-all revokes every session for the user", async () => {
      const reg = await request(app).post("/api/v1/auth/register").send(validUser);
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: validUser.email, password: validUser.password });

      const out = await request(app).post("/api/v1/auth/logout-all").set("Authorization", `Bearer ${reg.body.token}`);
      expect(out.status).toBe(204);

      for (const t of [reg.body.refreshToken, login.body.refreshToken]) {
        const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: t });
        expect(res.status).toBe(401);
      }
    });
  });
});
