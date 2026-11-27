
import express from "express";
import pool from "./db.mjs";

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

// Restrict notifications to the recipient
// and currently accessible work orders.

const scope = `
  n.recipient_id = $1
  AND EXISTS (
    SELECT 1
    FROM work_orders wo
    WHERE wo.id = n.work_order_id
      AND (
        wo.requester_id = $1
        OR (
          $2 = 'approver'
          AND wo.department_id = $3
          AND wo.status <> 'draft'
        )
        OR (
          $2 IN ('rnd', 'head')
          AND wo.approved_at IS NOT NULL
          AND wo.status IN (
            'new', 'received', 'planned',
            'progress', 'temporary', 'monitoring',
            'verification', 'ack', 'closed', 'unable'
          )
        )
      )
  )
`;

function params(req) {
  return [
    req.user.id,
    req.user.role,
    req.user.department_id
  ];
}

function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error("Notifications:", error.message);
      res.status(500).json({
        error: "Notification operation failed"
      });
    }
  };
}

// =====================================
// LIST PERSONAL NOTIFICATIONS
// =====================================

router.get("/", handler(async (req, res) => {
  const result = await pool.query(`
    SELECT
      n.id,
      n.work_order_id,
      n.event_type,
      n.title,
      n.message,
      n.created_at,
      n.read_at
    FROM notifications n
    WHERE ${scope}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 100
  `, params(req));

  res.json(result.rows);
}));

// =====================================
// UNREAD NOTIFICATION COUNT
// =====================================

router.get("/unread-count", handler(async (req, res) => {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM notifications n
    WHERE ${scope}
      AND n.read_at IS NULL
  `, params(req));

  res.json(result.rows[0]);
}));

// Protect notification updates

router.use((req, res, next) => {
  if (
    req.method === "PATCH" &&
    req.get("X-RND-Request") !== "1"
  ) {
    return res.status(403).json({
      error: "Invalid request"
    });
  }

  next();
});

// =====================================
// MARK ALL AS READ
// =====================================

router.patch("/read-all", handler(async (req, res) => {
  const result = await pool.query(`
    UPDATE notifications n
    SET read_at = NOW()
    WHERE ${scope}
      AND n.read_at IS NULL
  `, params(req));

  res.json({
    status: "success",
    updated: result.rowCount
  });
}));

// =====================================
// MARK ONE NOTIFICATION AS READ
// =====================================

router.patch("/:id/read", handler(async (req, res) => {
  const id = req.params.id;

  if (
    !/^[1-9][0-9]{0,18}$/.test(id) ||
    BigInt(id) > 9223372036854775807n
  ) {
    return res.status(400).json({
      error: "Invalid notification ID"
    });
  }

  const result = await pool.query(`
    UPDATE notifications n
    SET read_at = COALESCE(read_at, NOW())
    WHERE ${scope}
      AND n.id = $4
    RETURNING n.id, n.read_at
  `, [...params(req), id]);

  if (!result.rows.length) {
    return res.status(404).json({
      error: "Notification not found"
    });
  }

  res.json({
    status: "success",
    notification: result.rows[0]
  });
}));

export default router;
