/**
 * Authentication routes with session management
 * Uses Passport.js for session-based authentication
 */

const express = require('express');
const router = express.Router();

// Import auth handlers and middleware
const { handleAuth } = require('../../functions/route_fns/simpleAuth/login');
const { handleLogout } = require('../../functions/route_fns/simpleAuth/logout');
const { handleRegister } = require('../../functions/route_fns/simpleAuth/register');
const { isAuthenticated } = require('../../functions/middleware/authenticate');

/**
 * POST /api/auth/register
 * Create a new user account. First user is auto-approved admin.
 */
router.post('/register', handleRegister);

/**
 * GET /api/auth/pending-users
 * Admin only — list users waiting for approval
 */
router.get('/pending-users', isAuthenticated, (req, res) => {
    try {
        if (!req.user?.is_admin) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const { getDb } = require('../../database/connection');
        const db = getDb();
        const users = db.prepare(
            "SELECT id, email, status, is_admin, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC"
        ).all();
        return res.json({ success: true, data: { users } });
    } catch (error) {
        console.error('Pending users error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load pending users' });
    }
});

/**
 * POST /api/auth/approve/:id
 * Admin only — approve a pending user
 */
router.post('/approve/:id', isAuthenticated, (req, res) => {
    try {
        if (!req.user?.is_admin) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const { getDb } = require('../../database/connection');
        const db = getDb();
        const result = db.prepare("UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'").run(req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'User not found or already approved' });
        }
        return res.json({ success: true, message: 'User approved' });
    } catch (error) {
        console.error('Approve user error:', error);
        return res.status(500).json({ success: false, message: 'Failed to approve user' });
    }
});

/**
 * POST /api/auth/reject/:id
 * Admin only — reject/delete a pending user
 */
router.post('/reject/:id', isAuthenticated, (req, res) => {
    try {
        if (!req.user?.is_admin) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const { getDb } = require('../../database/connection');
        const db = getDb();
        db.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").run(req.params.id);
        return res.json({ success: true, message: 'User rejected' });
    } catch (error) {
        console.error('Reject user error:', error);
        return res.status(500).json({ success: false, message: 'Failed to reject user' });
    }
});

/**
 * POST /api/auth/login
 * Login with email and password
 * Creates session on successful authentication
 */
router.post('/login', handleAuth);

/**
 * POST /api/auth/logout
 * Logout and destroy session
 * Protected route - requires authentication
 */
router.post('/logout', isAuthenticated, handleLogout);

/**
 * GET /api/auth/me
 * Get current authenticated user
 * Protected route - requires authentication
 */
router.get('/me', isAuthenticated, (req, res) => {
	try {
		res.status(200).json({
			success: true,
			data: {
				user: {
					email: req.user.email,
					is_admin: Boolean(req.user.is_admin),
				},
			},
		});
	} catch (error) {
		console.error('Get current user error:', error);
		res.status(500).json({
			success: false,
			message: 'Failed to get user information',
		});
	}
});

/**
 * GET /api/auth/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
	try {
		res.status(200).json({
			success: true,
			message: 'Auth service is healthy',
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error('Health check error:', error);
		res.status(500).json({
			success: false,
			message: 'Health check failed',
		});
	}
});

module.exports = router;
