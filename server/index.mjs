import { fileURLToPath } from "node:url";
import express from "express";
import pool from "./db.mjs";
import { setupAuth, requireAuth } from "./auth.mjs";
import workOrders from "./work-orders.mjs";
import workflow from "./workflow.mjs";
import photos from "./photos.mjs";

const app = express();

const PORT = Number(process.env.PORT || 3901);
const HOST = process.env.HOST || "127.0.0.1";

app.use(express.json());

setupAuth(app);

// API status
app.get("/api/status", (req, res) => {
  res.json({
    application: "Sugihara R&D Work Order",
    status: "online"
  });
});

// Database connection test
app.get("/api/database/test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS username,
        NOW() AS server_time
    `);

    res.json({
      status: "connected",
      data: result.rows[0]
    });

  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      status: "connection_failed"
    });
  }
});

// Departments
app.get("/api/departments", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM departments
      ORDER BY id
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      error: "Failed to retrieve departments"
    });
  }
});

// Work order API
app.use("/api/work-orders/:id/photos", requireAuth, photos);
app.use("/api/work-orders", requireAuth, workflow);
app.use("/api/work-orders", requireAuth, workOrders);

// Start server

// Serve the production React frontend
const frontendPath = fileURLToPath(
  new URL("../dist/", import.meta.url)
);

app.use(express.static(frontendPath));

app.listen(PORT, HOST, () => {
  console.log("================================");
  console.log("SUGIHARA R&D WORK ORDER API");
  console.log(`http://${HOST}:${PORT}`);
  console.log("Authentication enabled");
  console.log("Work Order API enabled");
  console.log("Workflow API enabled");
  console.log("Photo API enabled");
  console.log("================================");
});
