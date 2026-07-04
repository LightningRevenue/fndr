/**
 * Passport.js configuration — authenticates against the users DB table.
 * Falls back to env ADMIN_EMAIL/ADMIN_PASSWORD for backwards-compat if no users exist yet.
 */

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { ADMIN_EMAIL, ADMIN_PASSWORD } = require('../../data/env');

passport.use(
	new LocalStrategy(
		{ usernameField: 'email', passwordField: 'password' },
		async (email, password, done) => {
			try {
				// Lazy-require to avoid circular init at module load time
				const { getDb } = require('../../database/connection');
				const db = getDb();

				/** @type {{ id: number, email: string, password_hash: string, status: string, is_admin: number } | undefined} */
				const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

				if (!user) {
					// Legacy fallback: env-based admin when no users table row exists
					if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
						return done(null, { email: ADMIN_EMAIL, is_admin: true });
					}
					return done(null, false, { message: 'Incorrect email or password. Please check your credentials and try again.' });
				}

				const match = await bcrypt.compare(password, user.password_hash);
				if (!match) {
					return done(null, false, { message: 'Incorrect email or password. Please check your credentials and try again.' });
				}

				if (user.status === 'pending') {
					return done(null, false, { message: 'Your account is pending approval. Please wait for an admin to approve your account.' });
				}

				return done(null, { email: user.email, is_admin: Boolean(user.is_admin) });

			} catch (error) {
				console.error('Passport authentication error:', String(error));
				return done(error);
			}
		}
	)
);

passport.serializeUser((user, done) => {
	try {
		done(null, user.email);
	} catch (error) {
		done(error);
	}
});

passport.deserializeUser((email, done) => {
	try {
		const { getDb } = require('../../database/connection');
		const db = getDb();
		const row = db.prepare('SELECT email, is_admin FROM users WHERE email = ?').get(email);
		if (row) {
			done(null, { email: row.email, is_admin: Boolean(row.is_admin) });
		} else {
			// Legacy env-admin session
			done(null, { email, is_admin: email === ADMIN_EMAIL });
		}
	} catch (error) {
		done(error);
	}
});

module.exports = passport;
