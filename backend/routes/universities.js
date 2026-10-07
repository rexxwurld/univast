const express = require("express");
const router = express.Router();

const { requireAdminForWrites } = require("../middleware/auth");

// Reads are public; every write to the campus-navigation data needs an admin.
router.use(requireAdminForWrites);

const universityController = require("../controllers/universityController");
const { validateObjectIdParam } = require("../middleware/validateObjectId");
const { validateRequiredFields } = require("../middleware/validation");

const REQUIRED_FIELDS = ["name", "ShortName", "country", "state"];

router.get("/", universityController.getAll);
router.get("/:id", validateObjectIdParam("id"), universityController.getOne);
router.post("/", validateRequiredFields(REQUIRED_FIELDS), universityController.create);
router.put("/:id", validateObjectIdParam("id"), universityController.update);
router.patch("/:id", validateObjectIdParam("id"), universityController.update);
router.delete("/:id", validateObjectIdParam("id"), universityController.remove);

module.exports = router;
