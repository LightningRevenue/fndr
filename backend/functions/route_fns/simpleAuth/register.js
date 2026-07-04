/**
 * Registration handler — creates a new user account.
 * The very first user registered is auto-approved and becomes admin.
 * All subsequent users start as 'pending' until the admin approves them.
 */

const bcrypt = require('bcryptjs');
const { getDb } = require('../../../database/connection');
const isValidEmail = require('../../utils/isValidEmail');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleRegister(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        if (!password || typeof password !== 'string' || password.length < 8 || password.length > 64) {
            return res.status(400).json({ success: false, message: 'Password must be between 8 and 64 characters' });
        }

        const db = getDb();

        // Check email already taken
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
        if (existing) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists. Try logging in instead.' });
        }

        // First user ever → auto-approved admin
        /** @type {{ count: number }} */
        const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get();
        const isFirst = count === 0;

        const password_hash = await bcrypt.hash(password, 12);

        db.prepare(
            'INSERT INTO users (email, password_hash, status, is_admin) VALUES (?, ?, ?, ?)'
        ).run(email.toLowerCase(), password_hash, isFirst ? 'approved' : 'pending', isFirst ? 1 : 0);

        return res.status(201).json({
            success: true,
            status: isFirst ? 'approved' : 'pending',
            message: isFirst
                ? 'Account created. You can now log in.'
                : 'Account created. Waiting for admin approval before you can log in.',
        });

    } catch (error) {
        console.error('Register error:', error);
        return res.status(500).json({ success: false, message: 'Registration failed due to server error' });
    }
}

module.exports = { handleRegister };
