
import express from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "./db.mjs";
import { canView, getOrder, validId } from "./photos.mjs";

const router = express.Router({ mergeParams: true });

const ROOT = fileURLToPath(
  new URL("../uploads/attachments/", import.meta.url)
);

const MAX_SIZE = 8 * 1024 * 1024;
const MAX_FILES = 10;

const allowedTypes = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SIZE,
    files: 1,
    fields: 1,
    fieldSize: 100
  }
});

const FIELDS = `
  id, work_order_id, file_name,
  file_size, mime_type, uploaded_by,
  uploaded_at, is_current
`;

router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

function canUpload(order, user) {
  return order &&
    String(order.requester_id) === String(user.id) &&
    ["draft", "correction"].includes(order.status);
}

// =====================================
// LIST ATTACHMENTS
// =====================================

router.get("/", async (req, res) => {
  try {
    const order = await getOrder(req.params.id);

    if (!order || !canView(order, req.user)) {
      return res.status(404).json({
        error: "Work order not found"
      });
    }

    const result = await pool.query(`
      SELECT
        a.id, a.work_order_id, a.file_name,
        a.file_size, a.mime_type, a.uploaded_by,
        a.uploaded_at, a.is_current,
        u.full_name AS uploaded_by_name
      FROM work_order_attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.work_order_id = $1
        AND a.is_current = TRUE
      ORDER BY a.uploaded_at DESC, a.id DESC
    `, [order.id]);

    res.json(result.rows);

  } catch (error) {
    console.error("Attachment list:", error.message);

    res.status(500).json({
      error: "Unable to retrieve attachments"
    });
  }
});

// =====================================
// DOWNLOAD ATTACHMENT
// =====================================

router.get("/:attachmentId/content", async (req, res) => {
  try {
    const order = await getOrder(req.params.id);

    if (
      !order ||
      !canView(order, req.user) ||
      !validId(req.params.attachmentId)
    ) {
      return res.status(404).json({
        error: "Attachment not found"
      });
    }

    const result = await pool.query(`
      SELECT file_name, file_path, mime_type
      FROM work_order_attachments
      WHERE id = $1
        AND work_order_id = $2
        AND is_current = TRUE
    `, [req.params.attachmentId, order.id]);

    const file = result.rows[0];

    if (
      !file ||
      !/^attachments\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/
        .test(file.file_path)
    ) {
      return res.status(404).json({
        error: "Attachment not found"
      });
    }

    const filename = path.join(
      ROOT,
      path.basename(file.file_path)
    );

    res.set({
      "Content-Type": file.mime_type,
      "X-Content-Type-Options": "nosniff"
    });

    res.download(filename, file.file_name, error => {
      if (error && !res.headersSent) {
        res.status(404).json({
          error: "Attachment file unavailable"
        });
      } else if (error) {
        res.destroy(error);
      }
    });

  } catch (error) {
    console.error("Attachment download:", error.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Unable to download attachment"
      });
    }
  }
});

// =====================================
// UPLOAD ATTACHMENT
// =====================================

router.post(
  "/",

  // Request and permission checks
  async (req, res, next) => {
    try {
      if (req.get("X-RND-Request") !== "1") {
        return res.status(403).json({
          error: "Invalid request"
        });
      }

      const order = await getOrder(req.params.id);

      if (!order || !canView(order, req.user)) {
        return res.status(404).json({
          error: "Work order not found"
        });
      }

      if (!canUpload(order, req.user)) {
        return res.status(403).json({
          error: "Attachment upload is not permitted"
        });
      }

      next();

    } catch (error) {
      next(error);
    }
  },

  upload.single("attachment"),

  async (req, res) => {
    let client;
    let savedPath;
    let commitAttempted = false;
    let committed = false;

    try {
      if (!req.file || !req.file.size) {
        return res.status(400).json({
          error: "Select a supporting document"
        });
      }

      const type = await fileTypeFromBuffer(
        req.file.buffer
      );

      if (!type || !allowedTypes[type.mime]) {
        return res.status(400).json({
          error: "Only PDF, JPG, PNG and WebP are supported"
        });
      }

      client = await pool.connect();

      await client.query("BEGIN");

      const order = await getOrder(
        req.params.id, client, true
      );

      // Recheck after locking the work order
      if (!canUpload(order, req.user)) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          error: "Attachment upload is not permitted"
        });
      }

      if (req.body.version !== String(order.version)) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          error: "Work order version has changed"
        });
      }

      const count = await client.query(`
        SELECT COUNT(*)::int AS total
        FROM work_order_attachments
        WHERE work_order_id = $1
          AND is_current = TRUE
      `, [order.id]);

      if (count.rows[0].total >= MAX_FILES) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "Maximum 10 attachments per work order"
        });
      }

      const extension = allowedTypes[type.mime];

      const storedName =
        randomUUID() + "." + extension;

      const originalName =
        path.basename(
          req.file.originalname.replace(/\\/g, "/")
        )
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 255) ||
        "attachment." + extension;

      savedPath = path.join(ROOT, storedName);

      await fs.writeFile(
        savedPath,
        req.file.buffer,
        { flag: "wx", mode: 0o600 }
      );

      const result = await client.query(`
        INSERT INTO work_order_attachments (
          work_order_id,
          file_name,
          file_path,
          file_size,
          mime_type,
          uploaded_by
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING ${FIELDS}
      `, [
        order.id,
        originalName,
        "attachments/" + storedName,
        req.file.size,
        type.mime,
        req.user.id
      ]);

      const attachment = result.rows[0];

      const version = await client.query(`
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
        "Supporting document uploaded",
        req.user.id,
        req.user.role,
        JSON.stringify([{
          field: "attachment",
          previous: null,
          updated: {
            id: attachment.id,
            file_name: originalName
          }
        }]),
        "Uploaded " + originalName
      ]);

      commitAttempted = true;

      await client.query("COMMIT");

      committed = true;

      res.status(201).json({
        status: "success",
        attachment,
        version: version.rows[0].version
      });

    } catch (error) {
      if (client && !committed) {
        await client.query("ROLLBACK").catch(() => {});
      }

      if (savedPath && !commitAttempted) {
        await fs.unlink(savedPath).catch(() => {});
      }

      console.error("Attachment upload:", error.message);

      res.status(500).json({
        error: "Attachment upload failed"
      });

    } finally {
      if (client) client.release();
    }
  }
);

// =====================================
// UPLOAD ERROR HANDLING
// =====================================

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    return res.status(
      error.code === "LIMIT_FILE_SIZE" ? 413 : 400
    ).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? "Maximum attachment size is 8 MB"
        : "Invalid attachment upload"
    });
  }

  console.error("Attachment error:", error.message);

  res.status(500).json({
    error: "Attachment processing failed"
  });
});

export default router;
