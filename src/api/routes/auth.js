
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const router = express.Router();

// Middleware
const { authLimiter } = require('../middleware/rateLimiter');
const { verifyToken } = require('../middleware/auth');

// DB
const { pool }= require('../../db/pool');


// ==========================
// 🔐 REGISTER
// ==========================
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hashedPassword]
    );

    return res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0],
    });

  } catch (err) {
    // Duplicate email
    if (err.code === '23505') {
      return res.status(400).json({ error: 'User already exists' });
    }

    console.error('[auth][register]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// ==========================
// 🔑 LOGIN
// ==========================
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    // User not found
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({
      message: 'Login successful',
      token,
    });

  } catch (err) {
    console.error('[auth][login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// ==========================
// 🔒 PROTECTED ROUTE
// ==========================
router.get('/me', verifyToken, (req, res) => {
  return res.json({
    message: 'Authenticated user',
    user: req.user,
  });
});


module.exports = router;
