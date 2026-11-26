import express from "express";
import pool from "./db.mjs";

const router = express.Router();

const teams = [
  "R&D", "Maintenance / Kaizen",
  "Mould maker", "Production", "Others"
];

const types = [
  "Mechanical", "Electrical",
  "Building", "Others"
];

const reasons = [
  "Repair / Damaged", "New / Improvement",
  "Safety", "Replacement", "Others"
];

function fail(status, message) {
  throw Object.assign(new Error(message), {
    httpStatus: status
  });
}

function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) return false;

  const date = new Date(value + "T00:00:00Z");

  return !isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function text(value, max, field) {
  if (typeof value !== "string" || value.length > max) {
    fail(400, "Invalid " + field);
  }
  return value.trim();
}

function choices(value, allowed, field) {
  if (
    !Array.isArray(value) ||
    !value.every(v => allowed.includes(v))
  ) fail(400, "Invalid " + field);

  return [...new Set(value)];
}

async function history(
  client, order, user, action, remarks, changes
) {
  await client.query(`
    INSERT INTO work_order_history (
      work_order_id, action, changed_by,
      account_role, remarks, changes
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
  `, [
    order.id, action, user.id,
    user.role, remarks, JSON.stringify(changes)
  ]);
}

function transaction(handler) {
  return async (req, res) => {
    let client;

    try {
      if (
        !req.is("application/json") ||
        req.get("X-RND-Request") !== "1"
      ) fail(403, "Invalid request");

      if (
        !/^[1-9][0-9]{0,18}$/.test(req.params.id) ||
        BigInt(req.params.id) > 9223372036854775807n
      ) fail(400, "Invalid work order ID");

      client = await pool.connect();
      await client.query("BEGIN");

      const result = await client.query(`
        SELECT *,
          requested_completion_date::text AS due_text
        FROM work_orders
        WHERE id = $1
        FOR UPDATE
      `, [req.params.id]);

      const order = result.rows[0];

      if (!order) fail(404, "Work order not found");

      const output = await handler(
        client, order, req
      );

      await client.query("COMMIT");

      res.json({
        status: "success",
        work_order: output
      });

    } catch (error) {
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
      }

      if (!error.httpStatus) {
        console.error(error.message);
      }

      res.status(error.httpStatus || 500).json({
        error: error.httpStatus
          ? error.message
          : "Workflow operation failed"
      });

    } finally {
      if (client) client.release();
    }
  };
}


// Save Part A request details with revision control
router.patch("/:id/request", transaction(
  async (client, order, req) => {
    const user = req.user;
    const body = req.body || {};

    const editable = [
      "draft", "correction", "new",
      "received", "planned", "progress",
      "temporary", "monitoring",
      "verification", "ack"
    ];

    if (
      order.requester_id !== user.id ||
      !editable.includes(order.status)
    ) fail(403, "Request editing not permitted");

    if (body.version !== order.version) {
      fail(409, "Work order version has changed");
    }

    const note = text(
      body.note ?? "", 2000, "revision reason"
    );

    const title = text(body.title, 255, "title");
    const section = text(body.section, 100, "section");

    const description = text(
      body.description, 10000, "description"
    );

    const reference = text(
      body.reference_no ?? "", 100, "reference number"
    );

    const due = body.due || null;

    if (due && !validDate(due)) {
      fail(400, "Invalid completion date");
    }

    const data = {
      team: text(body.team ?? "", 100, "team"),
      teamOther: text(body.teamOther ?? "", 500, "team details"),
      types: choices(body.types ?? [], types, "work types"),
      typeOther: text(body.typeOther ?? "", 500, "type details"),
      reasons: choices(body.reasons ?? [], reasons, "reasons"),
      reasonOther: text(body.reasonOther ?? "", 500, "reason details"),
      sketch: body.sketch ?? "No",
      priority: text(body.priority ?? "Normal", 50, "priority")
    };

    if (
      (data.team && !teams.includes(data.team)) ||
      !["Yes", "No"].includes(data.sketch)
    ) fail(400, "Invalid request selection");

    function equal(a, b) {
      if (
        a && b &&
        typeof a === "object" &&
        typeof b === "object" &&
        !Array.isArray(a) &&
        !Array.isArray(b)
      ) {
        const keys = new Set([
          ...Object.keys(a), ...Object.keys(b)
        ]);

        return [...keys].every(
          key => equal(a[key], b[key])
        );
      }

      return JSON.stringify(a) === JSON.stringify(b);
    }

    const changes = [
      ["title", order.title, title],
      ["section", order.section, section],
      ["description", order.description, description],
      ["reference_no", order.reference_no, reference],
      ["due", order.due_text, due],
      ...Object.keys(data).map(key => [
        key,
        order.request_data?.[key] ?? null,
        data[key]
      ])
    ].filter(
      ([field, before, after]) => !equal(before, after)
    ).map(([field, before, after]) => ({
      field,
      previous: before,
      updated: after
    }));

    if (!changes.length) {
      return order;
    }

    const submitted =
      !["draft", "correction"].includes(order.status);

    const material = changes.some(
      change => change.field !== "reference_no"
    );

    if (submitted && material) {
      if (!note) {
        fail(400, "Revision reason is required");
      }

      if (
        !title || !section || !description ||
        !due || !teams.includes(data.team) ||
        !data.types.length || !data.reasons.length
      ) fail(400, "Complete all required Part A fields");

      if (
        (["Production", "Others"].includes(data.team) &&
          !data.teamOther) ||
        (data.types.includes("Others") &&
          !data.typeOther) ||
        (data.reasons.includes("Others") &&
          !data.reasonOther)
      ) fail(400, "Specify Other or Production details");

      const photos = await client.query(`
        SELECT id
        FROM work_order_photos
        WHERE work_order_id = $1
          AND photo_type = 'before'
          AND is_current = TRUE
          AND file_size > 0
          AND file_size <= 8388608
          AND mime_type IN (
            'image/jpeg', 'image/png', 'image/webp'
          )
        LIMIT 1
      `, [order.id]);

      if (!photos.rows.length) {
        fail(400, "At least one before-work photo is required");
      }
    }

    const reapproval =
      submitted && material && !!order.approved_at;

    const result = await client.query(`
      UPDATE work_orders
      SET title = $2,
          section = $3,
          description = $4,
          reference_no = $5,
          requested_completion_date = $6,
          request_data = $7::jsonb,

          status = CASE
            WHEN $8 THEN 'new'
            ELSE status
          END,

          approved_at = CASE
            WHEN $8 THEN NULL
            ELSE approved_at
          END,

          received_at = CASE
            WHEN $8 THEN NULL
            ELSE received_at
          END,

          assigned_pic = CASE
            WHEN $8 THEN NULL
            ELSE assigned_pic
          END,

          estimated_completion_date = CASE
            WHEN $8 THEN NULL
            ELSE estimated_completion_date
          END,

          actual_start_date = CASE
            WHEN $8 THEN NULL
            ELSE actual_start_date
          END,

          actual_completion_date = CASE
            WHEN $8 THEN NULL
            ELSE actual_completion_date
          END,

          closed_at = CASE
            WHEN $8 THEN NULL
            ELSE closed_at
          END,

          rd_data = CASE
            WHEN $8 THEN '{}'::jsonb
            ELSE rd_data
          END,

          updated_at = NOW(),
          version = version + 1

      WHERE id = $1
      RETURNING *
    `, [
      order.id,
      title,
      section,
      description,
      reference,
      due,
      JSON.stringify(data),
      reapproval
    ]);

    const updated = result.rows[0];

    if (reapproval) {
      const resetFields = [
        "status", "approved_at", "received_at",
        "assigned_pic", "estimated_completion_date",
        "actual_start_date", "actual_completion_date",
        "closed_at", "rd_data"
      ];

      for (const field of resetFields) {
        if (!equal(order[field], updated[field])) {
          changes.push({
            field,
            previous: order[field],
            updated: updated[field]
          });
        }
      }

      // Preserve earlier R&D evidence as historical photos
      const archived = await client.query(`
        UPDATE work_order_photos
        SET is_current = FALSE
        WHERE work_order_id = $1
          AND photo_type IN ('inspection', 'after')
          AND is_current = TRUE
        RETURNING id
      `, [order.id]);

      for (const photo of archived.rows) {
        changes.push({
          field: "photo:" + photo.id + ":is_current",
          previous: true,
          updated: false
        });
      }
    }

    await history(
      client,
      order,
      user,
      reapproval
        ? "Request updated - reapproval required"
        : "Request details updated",
      note,
      changes
    );

    return updated;
  }
));

// Submit, approve, return, reject or receive
router.post("/:id/actions", transaction(
  async (client, order, req) => {
    const user = req.user;
    const { action, note = "", version } = req.body || {};

    const remarks = text(note, 2000, "remarks");

    const owner = order.requester_id === user.id;

    const approver =
      user.role === "approver" &&
      user.department_id !== null &&
      user.department_id === order.department_id &&
      !owner;

    const rnd = ["rnd", "head"].includes(user.role);

    const awaitingApproval =
      order.status === "new" && !order.approved_at;

    const awaitingReceipt =
      order.status === "new" && !!order.approved_at;

    let update;
    let label;
    let rdPatch = {};

    switch (action) {
      case "submit": {
        if (
          !owner ||
          !["draft", "correction"].includes(order.status)
        ) fail(403, "Submission not permitted");

        const d = order.request_data || {};

        if (
          !order.title?.trim() ||
          !order.section?.trim() ||
          !order.description?.trim() ||
          !order.requested_completion_date ||
          !teams.includes(d.team) ||
          !d.types?.length ||
          !d.reasons?.length
        ) fail(400, "Complete all required Part A fields");

        if (
          (["Production", "Others"].includes(d.team) &&
            !d.teamOther?.trim()) ||
          (d.types.includes("Others") &&
            !d.typeOther?.trim()) ||
          (d.reasons.includes("Others") &&
            !d.reasonOther?.trim())
        ) fail(400, "Specify Other or Production details");

        const photos = await client.query(`
          SELECT id
          FROM work_order_photos
          WHERE work_order_id = $1
            AND photo_type = 'before'
            AND is_current = TRUE
            AND file_size > 0
            AND file_size <= 8388608
            AND mime_type IN (
              'image/jpeg', 'image/png', 'image/webp'
            )
          LIMIT 1
        `, [order.id]);

        if (!photos.rows.length) {
          fail(400, "Upload at least one before-work photo");
        }

        update = `
          status = 'new',
          submitted_at = COALESCE(submitted_at, NOW()),
          approved_at = NULL,
          received_at = NULL
        `;

        label = "Request submitted";
        break;
      }

      case "approve":
        if (!approver || !awaitingApproval) {
          fail(403, "Approval not permitted");
        }

        update = "approved_at = NOW()";
        label = "Approved";
        break;

      case "return":
        if (
          !(approver && awaitingApproval) &&
          !(rnd && awaitingReceipt)
        ) fail(403, "Return not permitted");

        if (!remarks) {
          fail(400, "Correction reason is required");
        }

        update = `
          status = 'correction',
          approved_at = NULL,
          received_at = NULL
        `;

        label = "Returned for correction";
        break;

      case "reject":
        if (!approver || !awaitingApproval) {
          fail(403, "Rejection not permitted");
        }

        if (!remarks) {
          fail(400, "Rejection reason is required");
        }

        update = "status = 'rejected'";
        label = "Rejected";
        break;

      case "receive":
        if (!rnd || !awaitingReceipt) {
          fail(403, "Receipt not permitted");
        }

        update = `
          status = 'received',
          received_at = NOW()
        `;

        label = "Received by R&D";
        break;


      case "plan": {
        if (
          !rnd ||
          !order.approved_at ||
          order.status !== "received"
        ) fail(403, "Planning not permitted");

        const d = order.rd_data || {};

        if (
          !["Internal fabrication", "External party"]
            .includes(d.method) ||
          !order.assigned_pic ||
          !d.start ||
          !order.estimated_completion_date
        ) fail(400, "Complete work method, PIC and schedule");

        if (d.method === "External party" && !d.external) {
          fail(400, "Specify the external party");
        }

        const pic = await client.query(`
          SELECT id FROM users
          WHERE id = $1
            AND is_active = TRUE
            AND role IN ('rnd', 'head')
        `, [order.assigned_pic]);

        if (!pic.rows.length) {
          fail(400, "Assigned PIC is unavailable");
        }

        update = "status = 'planned'";
        label = "Work planned";
        break;
      }

      case "start":
        if (
          !rnd ||
          !order.approved_at ||
          order.status !== "planned"
        ) fail(403, "Work commencement not permitted");

        update = `
          status = 'progress',
          actual_start_date = NOW()
        `;

        label = "Work started";
        break;


      case "finish": {
        if (
          !rnd ||
          !order.approved_at ||
          !["progress", "temporary", "monitoring"]
            .includes(order.status)
        ) fail(403, "Completion not permitted");

        const d = order.rd_data || {};

        if (
          !order.actual_completion_date ||
          !d.completionRemarks ||
          typeof d.verificationRequired !== "boolean"
        ) fail(400, "Complete all work completion details");

        if (
          !order.actual_start_date ||
          new Date(order.actual_completion_date) <
            new Date(order.actual_start_date) ||
          new Date(order.actual_completion_date) > new Date()
        ) fail(400, "Invalid actual completion time");

        if (d.outcome === "Completed") {
          update = d.verificationRequired
            ? "status = 'verification'"
            : "status = 'ack'";

          label = "Work completed";

        } else if (d.outcome === "Use temporarily") {
          update = "status = 'temporary'";
          label = "Use temporarily";

        } else if (d.outcome === "Under monitoring") {
          update = "status = 'monitoring'";
          label = "Under monitoring";

        } else {
          fail(400, "Invalid completion outcome");
        }

        rdPatch = {
          completedBy: user.full_name,
          completedAt: new Date().toISOString(),
          verifiedBy: "",
          verifiedAt: "",
          ackBy: "",
          ackAt: ""
        };

        break;
      }

      case "verify":
        if (
          user.role !== "head" ||
          !order.approved_at ||
          order.status !== "verification"
        ) fail(403, "Verification not permitted");

        update = "status = 'ack'";
        label = "Accuracy verified";

        rdPatch = {
          verifiedBy: user.full_name,
          verifiedAt: new Date().toISOString()
        };

        break;

      case "rectify":
        if (
          !order.approved_at ||
          !(
            (user.role === "head" &&
             order.status === "verification") ||
            (owner && order.status === "ack")
          )
        ) fail(403, "Rectification not permitted");

        if (!remarks) {
          fail(400, "Rectification reason is required");
        }

        update = `
          status = 'progress',
          actual_completion_date = NULL
        `;

        label = "Returned for rectification";

        rdPatch = {
          actual: "",
          outcome: "",
          completionRemarks: "",
          completedBy: "",
          completedAt: "",
          verifiedBy: "",
          verifiedAt: "",
          ackBy: "",
          ackAt: ""
        };

        break;

      case "close":
        if (
          !owner ||
          !order.approved_at ||
          order.status !== "ack"
        ) fail(403, "Acknowledgement not permitted");

        update = `
          status = 'closed',
          closed_at = NOW()
        `;

        label = "Acknowledged and closed";

        rdPatch = {
          ackBy: user.full_name,
          ackAt: new Date().toISOString()
        };

        break;


      case "reopen":
        if (
          user.role !== "head" ||
          !order.approved_at ||
          order.status !== "closed"
        ) fail(403, "Reopening not permitted");

        if (!remarks) {
          fail(400, "Reopening reason is required");
        }

        update = `
          status = 'progress',
          actual_completion_date = NULL,
          closed_at = NULL
        `;

        label = "Work order reopened";

        rdPatch = {
          actual: "",
          outcome: "",
          completionRemarks: "",
          completedBy: "",
          completedAt: "",
          verifiedBy: "",
          verifiedAt: "",
          ackBy: "",
          ackAt: ""
        };

        break;

      case "unable":
        if (
          !rnd ||
          !order.approved_at ||
          ![
            "received",
            "planned",
            "progress",
            "temporary",
            "monitoring"
          ].includes(order.status)
        ) fail(403, "Action not permitted");

        if (!remarks) {
          fail(400, "Unable-to-proceed reason is required");
        }

        update = "status = 'unable'";

        label = "Unable to proceed";

        rdPatch = {
          method: "Unable to proceed",
          evaluation: remarks
        };

        break;

      default:
        fail(400, "Invalid workflow action");
    }

    if (version !== order.version) {
      fail(409, "Work order version has changed");
    }

    const result = await client.query(`
      UPDATE work_orders
      SET ${update},
          rd_data = rd_data || $2::jsonb,
          updated_at = NOW(),
          version = version + 1
      WHERE id = $1
      RETURNING *
    `, [order.id, JSON.stringify(rdPatch)]);

    const updated = result.rows[0];

    const changes = [
      "status", "submitted_at",
      "approved_at", "received_at", "actual_start_date", "actual_completion_date", "closed_at", "rd_data"
    ].filter(
      field => JSON.stringify(order[field]) !==
        JSON.stringify(updated[field])
    ).map(field => ({
      field,
      previous: order[field],
      updated: updated[field]
    }));

    await history(
      client, order, user,
      label, remarks, changes
    );

    return updated;
  }
));


// Retrieve eligible R&D PIC accounts
router.get("/planning/pics", async (req, res) => {
  try {
    if (!["rnd", "head"].includes(req.user.role)) {
      return res.status(403).json({
        error: "Access not permitted"
      });
    }

    const result = await pool.query(`
      SELECT id, full_name, employee_id, role
      FROM users
      WHERE role IN ('rnd', 'head')
        AND is_active = TRUE
      ORDER BY full_name
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Unable to retrieve PIC accounts"
    });
  }
});

// Save Part B planning details
router.patch("/:id/planning", transaction(
  async (client, order, req) => {
    const user = req.user;
    const body = req.body || {};

    if (
      !["rnd", "head"].includes(user.role) ||
      !order.approved_at ||
      order.status !== "received"
    ) fail(403, "Planning is not permitted");

    if (body.version !== order.version) {
      fail(409, "Work order version has changed");
    }

    const method = text(body.method, 100, "work method");
    const external = text(
      body.external ?? "", 500, "external party"
    );
    const evaluation = text(
      body.evaluation ?? "", 2000, "evaluation"
    );

    if (![
      "Internal fabrication",
      "External party"
    ].includes(method)) {
      fail(400, "Invalid work method");
    }

    if (method === "External party" && !external) {
      fail(400, "Specify the external party");
    }

    let pic = order.assigned_pic;

    // Only R&D Head can assign or change PIC
    if (body.assigned_pic !== undefined) {
      if (user.role !== "head") {
        fail(403, "Only R&D Head can assign PIC");
      }

      pic = body.assigned_pic;

      if (
        typeof pic !== "string" ||
        !/^[1-9][0-9]{0,18}$/.test(pic) ||
        BigInt(pic) > 9223372036854775807n
      ) fail(400, "Invalid PIC account");

      const eligible = await client.query(`
        SELECT id
        FROM users
        WHERE id = $1
          AND role IN ('rnd', 'head')
          AND is_active = TRUE
      `, [pic]);

      if (!eligible.rows.length) {
        fail(400, "PIC account is unavailable");
      }
    }

    function parseTime(value, field) {
      if (
        typeof value !== "string" ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(value)
      ) fail(400, "Specify timezone for " + field);

      const date = new Date(value);

      if (isNaN(date.getTime())) {
        fail(400, "Invalid " + field);
      }

      return date;
    }

    const start = parseTime(body.start, "planned start");
    const estimate = parseTime(
      body.estimate, "estimated completion"
    );

    if (estimate <= start) {
      fail(400, "Estimated completion must follow start");
    }

    const data = {
      ...order.rd_data,
      method,
      external,
      evaluation,
      start: start.toISOString(),
      estimate: estimate.toISOString()
    };

    const result = await client.query(`
      UPDATE work_orders
      SET rd_data = $2::jsonb,
          assigned_pic = $3,
          estimated_completion_date = $4,
          updated_at = NOW(),
          version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      order.id,
      JSON.stringify(data),
      pic,
      estimate
    ]);

    await history(
      client, order, user,
      "R&D planning details updated", "",
      [
        {
          field: "rd_data",
          previous: order.rd_data,
          updated: data
        },
        {
          field: "assigned_pic",
          previous: order.assigned_pic,
          updated: pic
        }
      ]
    );

    return result.rows[0];
  }
));



// Save work completion details
router.patch("/:id/completion", transaction(
  async (client, order, req) => {
    const user = req.user;
    const body = req.body || {};

    if (
      !["rnd", "head"].includes(user.role) ||
      !order.approved_at ||
      !["progress", "temporary", "monitoring"]
        .includes(order.status)
    ) fail(403, "Completion editing not permitted");

    if (body.version !== order.version) {
      fail(409, "Work order version has changed");
    }

    const outcomes = [
      "Completed",
      "Use temporarily",
      "Under monitoring"
    ];

    const outcome = text(
      body.outcome, 100, "completion outcome"
    );

    const remarks = text(
      body.completionRemarks, 5000, "completion remarks"
    );

    if (!outcomes.includes(outcome) || !remarks) {
      fail(400, "Complete outcome and justification");
    }

    if (typeof body.verificationRequired !== "boolean") {
      fail(400, "Specify verification requirement");
    }

    if (
      typeof body.actual !== "string" ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(body.actual)
    ) fail(400, "Specify actual date, time and timezone");

    const actual = new Date(body.actual);

    if (isNaN(actual.getTime())) {
      fail(400, "Invalid actual completion date");
    }

    if (
      !order.actual_start_date ||
      actual < new Date(order.actual_start_date)
    ) fail(400, "Completion cannot precede actual start");

    if (actual > new Date()) {
      fail(400, "Completion cannot be in the future");
    }

    const data = {
      ...order.rd_data,
      outcome,
      actual: actual.toISOString(),
      completionRemarks: remarks,
      verificationRequired: body.verificationRequired
    };

    const result = await client.query(`
      UPDATE work_orders
      SET rd_data = $2::jsonb,
          actual_completion_date = $3,
          updated_at = NOW(),
          version = version + 1
      WHERE id = $1
      RETURNING *
    `, [
      order.id,
      JSON.stringify(data),
      actual
    ]);

    await history(
      client, order, user,
      "Completion details updated", remarks,
      [
        {
          field: "rd_data",
          previous: order.rd_data,
          updated: data
        },
        {
          field: "actual_completion_date",
          previous: order.actual_completion_date,
          updated: actual
        }
      ]
    );

    return result.rows[0];
  }
));


export default router;
