const { z } = require("zod");

/**
 * Request-body schemas (zod). Unknown keys are stripped, so a client can't
 * smuggle extra fields (e.g. `role`, `isHidden`, `createdBy`) through a route
 * whose controller doesn't expect them.
 */

// ---- Auth ------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100, "name is too long"),
  email: z.string().trim().max(254).email("A valid email is required"),
  // bcrypt only uses the first 72 bytes, so longer passwords give a false sense of security.
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, "email is required").max(254),
  password: z.string().min(1, "password is required").max(200),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required").max(500),
});

// ---- Places ----------------------------------------------------------------

const optionalHttpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "website must start with http:// or https://");

const photosSchema = z.array(z.string().trim().max(500)).max(10);

const createPlaceSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  category: z.string().min(1, "category is required"),
  description: z.string().max(2000).optional(),
  address: z.string().max(300).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().max(40).optional(),
  website: optionalHttpUrl.optional(),
  photos: photosSchema.optional(),
});

const updatePlaceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
  address: z.string().max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().max(40).optional(),
  website: optionalHttpUrl.optional(),
  photos: photosSchema.optional(),
  openingHours: z.record(z.string().max(60)).optional(),
});

// ---- Reviews ---------------------------------------------------------------

const createReviewSchema = z.object({
  place: z.string().min(1, "place is required"),
  rating: z
    .number({ invalid_type_error: "rating must be a number between 1 and 5" })
    .min(1, "rating must be a number between 1 and 5")
    .max(5, "rating must be a number between 1 and 5"),
  text: z.string().max(2000).optional(),
  photos: z.array(z.string().trim().max(500)).max(5).optional(),
});

const updateReviewSchema = z.object({
  rating: z
    .number({ invalid_type_error: "rating must be a number between 1 and 5" })
    .min(1, "rating must be a number between 1 and 5")
    .max(5, "rating must be a number between 1 and 5")
    .optional(),
  text: z.string().max(2000).optional(),
  photos: z.array(z.string().trim().max(500)).max(5).optional(),
  isHidden: z.boolean().optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  createPlaceSchema,
  updatePlaceSchema,
  createReviewSchema,
  updateReviewSchema,
};
