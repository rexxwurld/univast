const express = require("express");
const router = express.Router();

const navigationEdgeController = require("../controllers/navigationEdgeController");
const { validateObjectIdParam, validateObjectIdBody } = require("../middleware/validateObjectId");
const { validateDistance, validateBoolean } = require("../middleware/validation");

router.get("/", navigationEdgeController.getAll);
router.get("/:id", validateObjectIdParam("id"), navigationEdgeController.getOne);

router.post(
  "/",
  validateObjectIdBody(["campusId", "from", "to"]),
  validateDistance({ required: true }),
  validateBoolean("bidirectional", { required: false }),
  navigationEdgeController.create
);

router.put(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([
    { name: "campusId", required: false },
    { name: "from", required: false },
    { name: "to", required: false },
  ]),
  validateDistance({ required: false }),
  validateBoolean("bidirectional", { required: false }),
  navigationEdgeController.update
);
router.patch(
  "/:id",
  validateObjectIdParam("id"),
  validateObjectIdBody([
    { name: "campusId", required: false },
    { name: "from", required: false },
    { name: "to", required: false },
  ]),
  validateDistance({ required: false }),
  validateBoolean("bidirectional", { required: false }),
  navigationEdgeController.update
);

router.delete("/:id", validateObjectIdParam("id"), navigationEdgeController.remove);

module.exports = router;
