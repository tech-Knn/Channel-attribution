const rateLimit = require("express-rate-limit");

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 300, // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later."
  },
});

// Stricter limiter for auth routes (login/signup)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // prevent brute force
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Try again in 15 minutes."
  },
});

module.exports = {
  apiLimiter,
  authLimiter,
};
