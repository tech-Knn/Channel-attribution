const rateLimit = require("express-rate-limit");

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 100, // 100 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later."
  },
});

// Stricter limiter for auth routes (login/signup)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // prevent brute force
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
