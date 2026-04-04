'use strict';

const jwt = require('jsonwebtoken');

// 🔐 Middleware to verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  // Expect format: Bearer <token>
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Access denied. No token provided.',
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'dev_secret'
    );

    // Attach decoded user to request
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(403).json({
      error: 'Invalid or expired token.',
    });
  }
}

module.exports = {
  verifyToken,
};