import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { rateLimit } from "express-rate-limit";
import pool from "./db.mjs";

const PgSession = connectPgSimple(session);

export function setupAuth(app) {
  if (!process.env.SESSION_SECRET ||
      process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET is missing or invalid");
  }

  app.use(session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),

    name: "rnd.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000
    }
  }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: {
      error: "Too many login attempts. Try again later."
    }
  });

  // Login
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body || {};

      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        !username.trim() ||
        !password ||
        username.length > 100 ||
        Buffer.byteLength(password) > 72
      ) {
        return res.status(400).json({
          error: "Invalid username or password"
        });
      }

      const result = await pool.query(`
        SELECT
          u.id,
          u.employee_id,
          u.username,
          u.full_name,
          u.password_hash,
          u.department_id,
          u.role,
          d.name AS department
        FROM users u
        LEFT JOIN departments d
          ON u.department_id = d.id
        WHERE u.username = $1
          AND u.is_active = TRUE
      `, [username.trim()]);

      const user = result.rows[0];

      if (!user ||
          !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({
          error: "Invalid username or password"
        });
      }

      const { password_hash, ...safeUser } = user;

      req.session.regenerate((error) => {
        if (error) {
          return res.status(500).json({
            error: "Unable to create session"
          });
        }

        req.session.userId = user.id;

        req.session.save((error) => {
          if (error) {
            return res.status(500).json({
              error: "Unable to save session"
            });
          }

          res.json({
            status: "success",
            user: safeUser
          });
        });
      });

    } catch (error) {
      console.error("Login error:", error.message);

      res.status(500).json({
        error: "Login failed"
      });
    }
  });

  // Current logged-in account
  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({
      authenticated: true,
      user: req.user
    });
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        return res.status(500).json({
          error: "Logout failed"
        });
      }

      res.clearCookie("rnd.sid");

      res.json({
        status: "logged_out"
      });
    });
  });
}

// Authentication middleware
export async function requireAuth(req, res, next) {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({
        error: "Please sign in"
      });
    }

    const result = await pool.query(`
      SELECT
        u.id,
        u.employee_id,
        u.username,
        u.full_name,
        u.department_id,
        u.role,
        d.name AS department
      FROM users u
      LEFT JOIN departments d
        ON u.department_id = d.id
      WHERE u.id = $1
        AND u.is_active = TRUE
    `, [req.session.userId]);

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Account unavailable"
      });
    }

    req.user = result.rows[0];

    next();

  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      error: "Authentication failed"
    });
  }
}
