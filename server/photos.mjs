import express from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "./db.mjs";

const router = express.Router({ mergeParams: true });

const ROOT = fileURLToPath(
  new URL("../uploads/", import.meta.url)
);

const MAX_SIZE = 8 * 1024 * 1024;

const allowedTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SIZE,
    files: 1,
    fields: 5,
    fieldSize: 4096
  }
});

const PHOTO_FIELDS = `
  id, work_order_id, photo_type,
  file_name, file_size, mime_type,
  description, uploaded_by, uploaded_at,
  supersedes_id, is_current
`;

const rdStatuses = [
  "new", "progress", "temporary", "monitoring",
  "verification", "ack", "unable",
  "approved",
  "received",
  "planned",
  "in_progress",
  "use_temporarily",
  "under_monitoring",
  "completed",
  "pending_verification",
  "pending_acknowledgement",
  "returned_for_rectification",
  "closed",
  "unable_to_proceed"
];

function validId(id) {
  return typeof id === "string" &&
    /^[1-9][0-9]{0,18}$/.test(id) &&
    BigInt(id) <= 9223372036854775807n;
}

function canView(order, user) {
  if (String(order.requester_id) === String(user.id)) {
    return true;
  }

  if (
    user.role === "approver" &&
    user.department_id &&
    String(user.department_id) ===
      String(order.department_id) &&
    order.status !== "draft"
  ) {
    return true;
  }

  return ["rnd", "head"].includes(user.role) &&
    Boolean(order.approved_at) &&
    rdStatuses.includes(order.status);
}

async function getOrder(id, client = pool, lock = false) {
  if (!validId(id)) return null;

  const result = await client.query(`
    SELECT *
    FROM work_orders
    WHERE id = $1
    ${lock ? "FOR UPDATE" : ""}
  `, [id]);

  return result.rows[0] || null;
}

// Retrieve photo records, including old versions
router.get("/", async (req, res) => {
  try {
    const order = await getOrder(req.params.id);

    if (!order || !canView(order, req.user)) {
      return res.status(404).json({
        error: "Work order not found"
      });
    }

    const result = await pool.query(`
      SELECT ${PHOTO_FIELDS}
      FROM work_order_photos
      WHERE work_order_id = $1
      ORDER BY uploaded_at DESC, id DESC
    `, [order.id]);

    res.json(result.rows);

  } catch (error) {
    console.error("Photo list:", error.message);
    res.status(500).json({
      error: "Unable to retrieve photos"
    });
  }
});

// Retrieve an actual image
router.get("/:photoId/content", async (req, res) => {
  try {
    const order = await getOrder(req.params.id);

    if (
      !order ||
      !canView(order, req.user) ||
      !validId(req.params.photoId)
    ) {
      return res.status(404).json({
        error: "Photo not found"
      });
    }

    const result = await pool.query(`
      SELECT file_path, mime_type
      FROM work_order_photos
      WHERE id = $1 AND work_order_id = $2
    `, [req.params.photoId, order.id]);

    const photo = result.rows[0];

    if (
      !photo ||
      !/^(before|inspection|after)\/[a-f0-9-]{36}\.(jpg|png|webp)$/
        .test(photo.file_path)
    ) {
      return res.status(404).json({
        error: "Photo not found"
      });
    }

    res.set({
      "Content-Type": photo.mime_type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    });

    res.sendFile(path.join(ROOT, photo.file_path));

  } catch (error) {
    console.error("Photo retrieval:", error.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Unable to retrieve photo"
      });
    }
  }
});

// Upload or replace a before-work photo
router.post(
  "/",
  (req, res, next) => {
    if (req.get("X-RND-Request") !== "1") {
      return res.status(403).json({
        error: "Invalid request"
      });
    }
    next();
  },
  upload.single("photo"),
  async (req, res) => {
    let client;
    let savedPath;
    let committed = false;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Photo is required"
        });
      }

      const type = await fileTypeFromBuffer(
        req.file.buffer
      );

      if (!type || !allowedTypes[type.mime]) {
        return res.status(400).json({
          error: "Unsupported image format"
        });
      }

      const photoType = req.body.photo_type || "before";
      const description = req.body.description || "";
      const replaces = req.body.replaces_photo_id || null;

      if (
        !["before", "inspection", "after"].includes(photoType) ||
        typeof description !== "string" ||
        description.length > 1000 ||
        (replaces !== null && !validId(replaces))
      ) {
        return res.status(400).json({
          error: "Invalid photo information"
        });
      }

      client = await pool.connect();
      await client.query("BEGIN");

      const order = await getOrder(
        req.params.id, client, true
      );

      const requesterUpload =
        order &&
        String(order.requester_id) ===
          String(req.user.id) &&
        [
          "draft", "correction", "new",
          "received", "planned", "progress",
          "temporary", "monitoring",
          "verification", "ack"
        ].includes(order.status) &&
        photoType === "before";

      const rdUpload =
        order &&
        ["rnd", "head"].includes(req.user.role) &&
        !!order.approved_at &&
        ["received", "planned", "progress",
         "temporary", "monitoring"].includes(order.status) &&
        ["inspection", "after"].includes(photoType);

      if (
        rdUpload &&
        order.status !== "received" &&
        !description.trim()
      ) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Provide a reason or description for the photo"
        });
      }

      if (!requesterUpload && !rdUpload) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          error: "Photo upload is not permitted"
        });
      }


      const submittedRevision =
        requesterUpload &&
        !["draft", "correction"].includes(order.status);

      const note = req.body.note || "";

      if (
        typeof note !== "string" ||
        note.length > 2000
      ) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Invalid revision reason"
        });
      }

      if (submittedRevision && !note.trim()) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Photo revision reason is required"
        });
      }

      if (
        submittedRevision &&
        req.body.version !== String(order.version)
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Work order version has changed"
        });
      }

      const reapproval =
        submittedRevision && !!order.approved_at;

      if (replaces) {
        const previous = await client.query(`
          UPDATE work_order_photos
          SET is_current = FALSE
          WHERE id = $1
            AND work_order_id = $2
            AND photo_type = $3
            AND is_current = TRUE
          RETURNING id
        `, [replaces, order.id, photoType]);

        if (!previous.rows.length) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            error: "Invalid previous photo"
          });
        }
      }

      const extension = allowedTypes[type.mime];

      const relativePath =
        `${photoType}/${randomUUID()}.${extension}`;

      savedPath = path.join(ROOT, relativePath);

      await fs.writeFile(
        savedPath,
        req.file.buffer,
        { flag: "wx", mode: 0o600 }
      );

      const result = await client.query(`
        INSERT INTO work_order_photos (
          work_order_id,
          photo_type,
          file_name,
          file_path,
          file_size,
          mime_type,
          description,
          uploaded_by,
          supersedes_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING ${PHOTO_FIELDS}
      `, [
        order.id,
        photoType,
        req.file.originalname.slice(0, 255),
        relativePath,
        req.file.size,
        type.mime,
        description,
        req.user.id,
        replaces
      ]);

      const photo = result.rows[0];

      const changes = [{
        photo_id: photo.id,
        previous_photo_id: replaces
      }];

      if (reapproval) {
        const reset = await client.query(`
          UPDATE work_orders
          SET status = 'new',
              approved_at = NULL,
              received_at = NULL,
              assigned_pic = NULL,
              estimated_completion_date = NULL,
              actual_start_date = NULL,
              actual_completion_date = NULL,
              closed_at = NULL,
              rd_data = '{}'::jsonb
          WHERE id = $1
          RETURNING *
        `, [order.id]);

        const updated = reset.rows[0];

        for (const field of [
          "status", "approved_at", "received_at",
          "assigned_pic", "estimated_completion_date",
          "actual_start_date", "actual_completion_date",
          "closed_at", "rd_data"
        ]) {
          if (
            JSON.stringify(order[field]) !==
            JSON.stringify(updated[field])
          ) {
            changes.push({
              field,
              previous: order[field],
              updated: updated[field]
            });
          }
        }

        const archived = await client.query(`
          UPDATE work_order_photos
          SET is_current = FALSE
          WHERE work_order_id = $1
            AND photo_type IN ('inspection', 'after')
            AND is_current = TRUE
          RETURNING id
        `, [order.id]);

        for (const previous of archived.rows) {
          changes.push({
            field: "photo:" + previous.id + ":is_current",
            previous: true,
            updated: false
          });
        }
      }

      const versionResult = await client.query(`
        UPDATE work_orders
        SET updated_at = NOW(),
            version = version + 1
        WHERE id = $1
        RETURNING version
      `, [order.id]);



      await client.query(`
        INSERT INTO work_order_history (
          work_order_id,
          action,
          changed_by,
          account_role,
          changes,
          remarks
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      `, [
        order.id,
        reapproval
          ? "Photo revised - reapproval required"
          : replaces ? "Photo replaced" : "Photo uploaded",
        req.user.id,
        req.user.role,
        JSON.stringify(changes),
        `${photoType} photo: ${description} ${note}`.trim()
      ]);

      await client.query("COMMIT");
      committed = true;

      res.status(201).json({
        status: "success",
        photo,
        version: versionResult.rows[0].version,
        reapproval_required: reapproval
      });

    } catch (error) {
      if (client && !committed) {
        await client.query("ROLLBACK").catch(() => {});
      }

      if (savedPath && !committed) {
        await fs.unlink(savedPath).catch(() => {});
      }

      console.error("Photo upload:", error.message);

      res.status(500).json({
        error: "Photo upload failed"
      });

    } finally {
      if (client) client.release();
    }
  }
);

// Upload error handling
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(
      error.code === "LIMIT_FILE_SIZE" ? 413 : 400
    ).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? "Maximum photo size is 8 MB"
        : "Invalid photo upload"
    });
  }

  console.error(error.message);

  res.status(500).json({
    error: "Photo processing failed"
  });
});

export default router;

export { canView, getOrder, validId };
