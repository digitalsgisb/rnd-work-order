import * as module from 'web-push';
import pool from './db.mjs';

const webpush = module.default || module;

const eligible = `
  SELECT
    n.id AS notification_id,
    n.event_type,
    p.id AS subscription_id,
    p.endpoint,
    p.p256dh,
    p.auth
  FROM notifications n
  JOIN push_subscriptions p
    ON p.user_id = n.recipient_id
  JOIN users u
    ON u.id = p.user_id
  JOIN user_sessions s
    ON s.sid = p.session_id
  JOIN work_orders wo
    ON wo.id = n.work_order_id

  WHERE u.is_active = TRUE

    AND s.expire > NOW()
    AND s.sess->>'userId' = u.id::text

    AND n.read_at IS NULL

    AND n.created_at >= p.updated_at

    AND n.created_at >
        NOW() - INTERVAL '10 minutes'

    AND (
      wo.requester_id = u.id

      OR (
        u.role = 'approver'
        AND u.department_id = wo.department_id
        AND wo.status <> 'draft'
      )

      OR (
        u.role IN ('rnd','head')
        AND wo.approved_at IS NOT NULL
        AND wo.status IN (
          'new','received','planned',
          'progress','temporary','monitoring',
          'verification','ack','closed','unable'
        )
      )
    )

    AND NOT EXISTS (
      SELECT 1 FROM push_deliveries d
      WHERE d.notification_id = n.id
        AND d.subscription_id = p.id
    )
`;

function validEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname;

    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (
        host === 'fcm.googleapis.com' ||
        host.endsWith('.push.apple.com') ||
        host.endsWith('.push.services.mozilla.com')
      );
  } catch {
    return false;
  }
}

async function run() {

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const result = await pool.query(
    eligible + `
      ORDER BY n.created_at ASC
      LIMIT 20
    `
  );

  for (const item of result.rows) {

    // Recheck access and claim delivery
    const claimed = await pool.query(`
      WITH candidate AS (
        ${eligible}
        AND n.id = $1
        AND p.id = $2
      ),
      inserted AS (
        INSERT INTO push_deliveries (
          notification_id,
          subscription_id
        )
        SELECT notification_id, subscription_id
        FROM candidate
        ON CONFLICT DO NOTHING
        RETURNING notification_id, subscription_id
      )
      SELECT candidate.*
      FROM candidate
      JOIN inserted USING (
        notification_id, subscription_id
      )
    `, [
      item.notification_id,
      item.subscription_id
    ]);

    const device = claimed.rows[0];

    if (!device) continue;

    try {

      if (!validEndpoint(device.endpoint)) {
        throw new Error('Unsupported endpoint');
      }

      const subscription = {
        endpoint: device.endpoint,
        keys: {
          p256dh: device.p256dh,
          auth: device.auth
        }
      };

      const payload = JSON.stringify({
        notificationId: device.notification_id,
        eventType: device.event_type
      });

      const response = await webpush.sendNotification(
        subscription,
        payload,
        {
          TTL: 120,
          urgency: 'high',
          timeout: 10000
        }
      );

      await pool.query(`
        UPDATE push_deliveries
        SET status = 'sent',
            sent_at = NOW(),
            http_status = $3
        WHERE notification_id = $1
          AND subscription_id = $2
      `, [
        device.notification_id,
        device.subscription_id,
        response.statusCode
      ]);

      console.log(
        'PUSH SENT | Notification:',
        device.notification_id,
        '| Device:',
        device.subscription_id
      );

    } catch (error) {

      await pool.query(`
        UPDATE push_deliveries
        SET status = 'failed',
            http_status = $3
        WHERE notification_id = $1
          AND subscription_id = $2
      `, [
        device.notification_id,
        device.subscription_id,
        error.statusCode || null
      ]);

      console.error(
        'PUSH FAILED | Notification:',
        device.notification_id,
        '| HTTP:',
        error.statusCode || 'unavailable'
      );

      // Remove expired browser subscriptions
      if ([404,410].includes(error.statusCode)) {
        await pool.query(`
          DELETE FROM push_subscriptions
          WHERE id = $1
            AND endpoint = $2
        `, [
          device.subscription_id,
          device.endpoint
        ]);
      }
    }
  }
}

try {
  await run();
} catch (error) {
  console.error(
    'Push worker failed:',
    error.code || error.name
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
