import express from "express";
import pool from "./db.mjs";

const router = express.Router();

// Retrieve work orders based on account permissions
router.get("/", async (req, res) => {
  try {
    const user = req.user;

    const result = await pool.query(`
      SELECT
        wo.*,
        d.name AS department,
        u.full_name AS requester,
        pic.full_name AS pic_name
      FROM work_orders wo
      LEFT JOIN departments d
        ON wo.department_id = d.id
      LEFT JOIN users u
        ON wo.requester_id = u.id
      LEFT JOIN users pic
        ON wo.assigned_pic = pic.id
      WHERE
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
            'new', 'progress', 'temporary', 'monitoring', 'verification', 'ack', 'unable', 'approved',
            'received',
            'planned',
            'in_progress',
            'use_temporarily',
            'under_monitoring',
            'completed',
            'pending_verification',
            'pending_acknowledgement',
            'returned_for_rectification',
            'closed',
            'unable_to_proceed'
          )
        )
      ORDER BY wo.created_at DESC
    `, [
      user.id,
      user.role,
      user.department_id
    ]);

    res.json(result.rows);

  } catch (error) {
    console.error("Work order error:", error.message);

    res.status(500).json({
      error: "Failed to retrieve work orders"
    });
  }
});

// Create a new work order draft
router.post("/", async (req, res) => {
  let client;

  try {
    if (
      !req.is("application/json") ||
      req.get("X-RND-Request") !== "1"
    ) {
      return res.status(403).json({
        error: "Invalid request"
      });
    }

    const user = req.user;

    const {
      title,
      reference_no = "",
      description = "",
      section = ""
    } = req.body || {};

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 255 ||
      typeof reference_no !== "string" ||
      reference_no.length > 100 ||
      typeof description !== "string" ||
      description.length > 10000 ||
      typeof section !== "string" ||
      section.length > 100
    ) {
      return res.status(400).json({
        error: "Invalid work order information"
      });
    }

    client = await pool.connect();

    await client.query("BEGIN");

    // Generate a unique work order number
    const sequence = await client.query(`
      SELECT
        nextval(
          pg_get_serial_sequence('work_orders', 'id')
        ) AS id,
        TO_CHAR(
          NOW() AT TIME ZONE 'Asia/Kuala_Lumpur',
          'YYYY'
        ) AS year
    `);

    const { id, year } = sequence.rows[0];

    const workOrderId =
      "WO-" + year + "-" + String(id).padStart(4, "0");

    const result = await client.query(`
      INSERT INTO work_orders (
        id,
        work_order_id,
        reference_no,
        requester_id,
        department_id,
        section,
        title,
        description,
        status
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, 'draft'
      )
      RETURNING *
    `, [
      id,
      workOrderId,
      reference_no,
      user.id,
      user.department_id,
      section,
      title.trim(),
      description
    ]);

    const order = result.rows[0];

    // Record creation in activity history
    await client.query(`
      INSERT INTO work_order_history (
        work_order_id,
        action,
        changed_by,
        account_role,
        remarks
      )
      VALUES ($1, $2, $3, $4, $5)
    `, [
      order.id,
      "Work order draft created",
      user.id,
      user.role,
      "New work order created"
    ]);

    await client.query("COMMIT");

    res.status(201).json({
      status: "success",
      work_order: order
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
    }

    console.error("Create order error:", error.message);

    res.status(500).json({
      error: "Failed to create work order"
    });

  } finally {
    if (client) client.release();
  }
});


// Retrieve authorized work order activity history
router.get("/:id/history", async (req, res) => {
  try {
    const user = req.user;
    const id = req.params.id;

    if (
      !/^[1-9][0-9]{0,18}$/.test(id) ||
      BigInt(id) > 9223372036854775807n
    ) {
      return res.status(400).json({
        error: "Invalid work order ID"
      });
    }

    const result = await pool.query(`
      SELECT
        h.id,
        h.action,
        h.account_role,
        h.changed_by,
        h.changes,
        h.remarks,
        h.created_at,
        u.full_name AS changed_by_name
      FROM work_orders wo
      LEFT JOIN work_order_history h
        ON h.work_order_id = wo.id
      LEFT JOIN users u
        ON u.id = h.changed_by
      WHERE wo.id = $1
        AND (
          wo.requester_id = $2
          OR (
            $3 = 'approver'
            AND wo.department_id = $4
            AND wo.status <> 'draft'
          )
          OR (
            $3 IN ('rnd', 'head')
            AND wo.approved_at IS NOT NULL
            AND wo.status IN (
              'new', 'received', 'planned',
              'progress', 'temporary', 'monitoring',
              'verification', 'ack', 'closed', 'unable',
              'approved', 'in_progress', 'use_temporarily',
              'under_monitoring', 'completed',
              'pending_verification',
              'pending_acknowledgement',
              'returned_for_rectification',
              'unable_to_proceed'
            )
          )
        )
      ORDER BY h.id ASC
    `, [
      id,
      user.id,
      user.role,
      user.department_id
    ]);

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Work order not found"
      });
    }

    res.set("Cache-Control", "private, no-store");

    res.json(result.rows.filter(row => row.id !== null));

  } catch (error) {
    console.error("History error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve activity history"
    });
  }
});


export default router;
