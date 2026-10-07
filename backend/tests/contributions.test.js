const request = require("supertest");
const app = require("../app");
const Building = require("../models/Building");
const UploadedFile = require("../models/UploadedFile");
const { canonicalChangeDigest } = require("../services/contributionService");
const { seedDevFixture } = require("../seeds/devFixture");
const { connect, closeDatabase, clearDatabase } = require("./testDb");
const { registerUser, registerWithRole, registerCoordinator } = require("./fixtures");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function contributionBody(fixture, overrides = {}) {
  return {
    title: "Correct building information",
    description: "The current description is outdated.",
    campusId: String(fixture.campusId),
    targetModel: "Building",
    targetId: String(fixture.buildingId),
    proposedChanges: { description: "Updated description", details: { source: "student", year: 2026 } },
    ...overrides,
  };
}

describe("community contributions", () => {
  it("canonicalizes nested proposed changes without collisions", () => {
    expect(canonicalChangeDigest({ a: 1, nested: { b: 2, c: 3 } })).toBe(
      canonicalChangeDigest({ nested: { c: 3, b: 2 }, a: 1 })
    );
    expect(canonicalChangeDigest({ nested: { b: 2, c: 3 } })).not.toBe(
      canonicalChangeDigest({ nested: { b: 2, c: 4 } })
    );
  });

  it("limits ordinary users to their own submissions while moderators can review all", async () => {
    const fixture = await seedDevFixture();
    const first = await registerUser();
    const second = await registerUser();
    const moderator = await registerWithRole("moderator");

    const post = (token) => request(app).post("/api/v1/contributions").set(auth(token)).send(contributionBody(fixture));
    expect((await post(first.token)).status).toBe(201);
    expect((await post(second.token)).status).toBe(201);

    const own = await request(app).get("/api/v1/contributions").set(auth(first.token));
    expect(own.status).toBe(200);
    expect(own.body.results).toHaveLength(1);
    expect(String(own.body.results[0].submitterId)).toBe(first.user.id);

    const all = await request(app).get("/api/v1/contributions").set(auth(moderator.token));
    expect(all.status).toBe(200);
    expect(all.body.results).toHaveLength(2);
  });

  it("records the actual prior status when a moderator approves a contribution", async () => {
    const fixture = await seedDevFixture();
    const submitter = await registerUser();
    const moderator = await registerWithRole("moderator");
    const created = await request(app)
      .post("/api/v1/contributions")
      .set(auth(submitter.token))
      .send(contributionBody(fixture, { proposedChanges: { description: "Verified description" } }));
    expect(created.status).toBe(201);

    const reviewed = await request(app)
      .patch(`/api/v1/contributions/${created.body._id}/review`)
      .set(auth(moderator.token))
      .send({ action: "APPROVED", notes: "Confirmed against campus records." });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("APPROVED");
    expect(reviewed.body.history.at(-1)).toMatchObject({ previousStatus: "SUBMITTED", nextStatus: "APPROVED" });
    expect((await Building.findById(fixture.buildingId)).description).toBe("Verified description");
  });

  it("does not let a campus coordinator query outside assigned campus scope", async () => {
    const fixture = await seedDevFixture();
    const owner = await registerUser();
    const coordinator = await registerCoordinator([fixture.campusId]);
    await request(app).post("/api/v1/contributions").set(auth(owner.token)).send(contributionBody(fixture));

    const allowed = await request(app).get("/api/v1/contributions").set(auth(coordinator.token)).query({ campusId: String(fixture.campusId) });
    const denied = await request(app).get("/api/v1/contributions").set(auth(coordinator.token)).query({ campusId: "507f1f77bcf86cd799439011" });
    expect(allowed.body.results).toHaveLength(1);
    expect(denied.body.results).toHaveLength(0);
  });

  it("accepts only the submitter's unattached quarantined evidence", async () => {
    const fixture = await seedDevFixture();
    const owner = await registerUser();
    const other = await registerUser();
    const evidence = await UploadedFile.create({
      ownerId: owner.user.id,
      storageKey: "0123456789abcdef0123456789abcdef",
      originalName: "campus.pdf",
      sniffedMime: "application/pdf",
      kind: "document",
      sizeBytes: 64,
      sha256: "a".repeat(64),
    });
    const body = contributionBody(fixture, { evidenceFileIds: [String(evidence._id)] });

    const rejected = await request(app).post("/api/v1/contributions").set(auth(other.token)).send(body);
    expect(rejected.status).toBe(400);
    expect(await UploadedFile.findById(evidence._id).then(file => file.contributionId)).toBeNull();

    const accepted = await request(app).post("/api/v1/contributions").set(auth(owner.token)).send(body);
    expect(accepted.status).toBe(201);
    expect(String((await UploadedFile.findById(evidence._id)).contributionId)).toBe(accepted.body._id);
  });

  it("lets only the owner resubmit a requested change without changing its target", async () => {
    const fixture = await seedDevFixture();
    const owner = await registerUser();
    const other = await registerUser();
    const moderator = await registerWithRole("moderator");
    const created = await request(app).post("/api/v1/contributions").set(auth(owner.token)).send(contributionBody(fixture));
    const requested = await request(app)
      .patch(`/api/v1/contributions/${created.body._id}/review`)
      .set(auth(moderator.token))
      .send({ action: "CHANGES_REQUESTED", notes: "Please verify the description." });
    expect(requested.body.status).toBe("CHANGES_REQUESTED");

    const update = {
      title: "Corrected building information",
      description: "Updated after review.",
      targetModel: "Building",
      targetId: String(fixture.buildingId),
      proposedChanges: { description: "Verified updated description" },
    };
    const forbidden = await request(app).patch(`/api/v1/contributions/${created.body._id}/resubmit`).set(auth(other.token)).send(update);
    expect(forbidden.status).toBe(404);
    const changedTarget = await request(app).patch(`/api/v1/contributions/${created.body._id}/resubmit`).set(auth(owner.token)).send({ ...update, targetId: "507f1f77bcf86cd799439011" });
    expect(changedTarget.status).toBe(400);
    const resubmitted = await request(app).patch(`/api/v1/contributions/${created.body._id}/resubmit`).set(auth(owner.token)).send(update);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.status).toBe("SUBMITTED");
    expect(resubmitted.body.targetId).toBe(String(fixture.buildingId));
    expect(resubmitted.body.history.at(-1)).toMatchObject({ previousStatus: "CHANGES_REQUESTED", nextStatus: "SUBMITTED" });
  });
});