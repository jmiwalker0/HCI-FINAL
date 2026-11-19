
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: "2h" }
    );
}

// REGISTER
router.post("/register", async (req, res) => {
    try {
        const { full_name, email, password } = req.body;

        // Validate required fields
        if (!full_name || !email || !password) {
            return res.status(400).json({
                error: "All fields are required."
            });
        }

        // Validate name
        if (!full_name.trim()) {
            return res.status(400).json({
                error: "Full name cannot be empty."
            });
        }

        // Validate email
        const normalizedEmail = email.trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({
                error: "Please enter a valid email address."
            });
        }

        // Validate password
        if (password.length < 8) {
            return res.status(400).json({
                error: "Password must be at least 8 characters."
            });
        }

        // Check if email already exists
        const existing = await db.query(
            "SELECT id FROM users WHERE email = $1",
            [normalizedEmail]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({
                error: "Email is already registered."
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Insert new user
        const result = await db.query(
            `INSERT INTO users (full_name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, full_name, email`,
            [full_name.trim(), normalizedEmail, passwordHash]
        );

        const user = result.rows[0];

        // Generate JWT token
        const token = generateToken(user);

        // Return token and user
        return res.status(201).json({
            message: "Account created successfully.",
            token,
            user
        });

    } catch (error) {
        console.error("Registration error:", error);

        // Handle duplicate email database constraint
        if (error.code === "23505") {
            return res.status(409).json({
                error: "Email is already registered."
            });
        }

        return res.status(500).json({
            error: "Unable to create account."
        });
    }
});


// LOGIN
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                error: "Email and password are required."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Find user
        const result = await db.query(
            `SELECT id, full_name, email, password_hash
             FROM users
             WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: "Invalid email or password."
            });
        }

        const user = result.rows[0];

        // Compare password
        const validPassword = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!validPassword) {
            return res.status(401).json({
                error: "Invalid email or password."
            });
        }

        // Generate JWT token
        const token = generateToken(user);

        // Return token and user
        return res.status(200).json({
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            error: "Unable to log in."
        });
    }
});

module.exports = router;
