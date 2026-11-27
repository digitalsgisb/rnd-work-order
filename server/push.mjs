
import express from "express";
import pool from "./db.mjs";

const router = express.Router();

router.use((req,res,next)=>{
  res.set("Cache-Control","private, no-store");

  if (
    req.method === "POST" &&
    req.get("X-RND-Request") !== "1"
  ) {
    return res.status(403).json({
      error:"Invalid request"
    });
  }

  next();
});

// Validate supported push service endpoints

function validEndpoint(value) {
  try {
    if (
      typeof value !== "string" ||
      value.length > 2048
    ) return false;

    const url = new URL(value);
    const host = url.hostname;

    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (
        host === "fcm.googleapis.com" ||
        host.endsWith(".push.apple.com") ||
        host.endsWith(".push.services.mozilla.com")
      );

  } catch {
    return false;
  }
}

function validKey(value,length) {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]+={0,2}$/.test(value) &&
    value.length <= 200 &&
    Buffer.from(value,"base64url").length === length;
}

// Public VAPID key

router.get("/public-key",(req,res)=>{
  const publicKey = process.env.VAPID_PUBLIC_KEY;

  if (!publicKey) {
    return res.status(503).json({
      error:"Push notifications unavailable"
    });
  }

  res.json({publicKey});
});

// Register device

router.post("/subscribe",async(req,res)=>{
  try {
    const {endpoint,keys} = req.body || {};

    if (
      !validEndpoint(endpoint) ||
      !validKey(keys?.p256dh,65) ||
      !validKey(keys?.auth,16)
    ) {
      return res.status(400).json({
        error:"Invalid device subscription"
      });
    }

    await pool.query(`
      INSERT INTO push_subscriptions (
        user_id,
        session_id,
        endpoint,
        p256dh,
        auth
      )
      VALUES ($1,$2,$3,$4,$5)

      ON CONFLICT (endpoint)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        session_id = EXCLUDED.session_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        updated_at = NOW()
    `,[
      req.user.id,
      req.sessionID,
      endpoint,
      keys.p256dh,
      keys.auth
    ]);

    res.status(201).json({
      status:"success",
      enabled:true
    });

  } catch(error) {
    console.error("Push registration failed");

    res.status(500).json({
      error:"Unable to register device"
    });
  }
});

// Check registered device


// Reconnect an existing device for the same employee

router.post("/reconnect",async(req,res)=>{
  try {
    const {endpoint,keys} = req.body || {};

    if (
      !validEndpoint(endpoint) ||
      !validKey(keys?.p256dh,65) ||
      !validKey(keys?.auth,16)
    ) {
      return res.status(400).json({
        error:"Invalid device subscription"
      });
    }

    const result = await pool.query(`
      UPDATE push_subscriptions
      SET
        updated_at = CASE
          WHEN session_id IS DISTINCT FROM $2
          THEN NOW()
          ELSE updated_at
        END,
        session_id = $2

      WHERE user_id = $1
        AND endpoint = $3
        AND p256dh = $4
        AND auth = $5

      RETURNING id
    `,[
      req.user.id,
      req.sessionID,
      endpoint,
      keys.p256dh,
      keys.auth
    ]);

    res.json({
      enabled:result.rows.length > 0
    });

  } catch {
    res.status(500).json({
      error:"Unable to reconnect device"
    });
  }
});

router.post("/status",async(req,res)=>{
  try {
    const result = await pool.query(`
      SELECT id
      FROM push_subscriptions
      WHERE user_id = $1
        AND session_id = $2
        AND endpoint = $3
    `,[
      req.user.id,
      req.sessionID,
      req.body?.endpoint || ""
    ]);

    res.json({
      enabled:result.rows.length > 0
    });

  } catch {
    res.status(500).json({
      error:"Unable to check device"
    });
  }
});

// Disable notifications on this device

router.post("/unsubscribe",async(req,res)=>{
  try {
    await pool.query(`
      DELETE FROM push_subscriptions
      WHERE user_id = $1
        AND session_id = $2
        AND endpoint = $3
    `,[
      req.user.id,
      req.sessionID,
      req.body?.endpoint || ""
    ]);

    res.json({
      status:"success",
      enabled:false
    });

  } catch {
    res.status(500).json({
      error:"Unable to unregister device"
    });
  }
});

export default router;
