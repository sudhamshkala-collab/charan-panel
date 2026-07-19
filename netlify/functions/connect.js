const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").replace(/[\r\n\t]/g, " ").trim();
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
    });
  } catch (e) {
    console.error("Firebase init failed:", e.message);
  }
}

const db = admin.firestore();
const SECRET = "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E";

function md5(str) {
  const crypto = require("crypto");
  return crypto.createHash("md5").update(str).digest("hex");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: false, reason: "Method not allowed" }),
    };
  }

  try {
    if (!db) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: false, reason: "Database not connected" }),
      };
    }

    let game, user_key, serial;
    const contentType = (event.headers["content-type"] || "").toLowerCase();
    const rawBody = (event.body || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(rawBody || "{}");
      game = parsed.game;
      user_key = parsed.user_key;
      serial = parsed.serial;
    } else {
      const params = new URLSearchParams(rawBody);
      game = params.get("game");
      user_key = params.get("user_key");
      serial = params.get("serial");
    }

    if (!game || !user_key || !serial) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: false, reason: "Missing required fields: game, user_key, serial" }),
      };
    }

    const keysSnapshot = await db.collection("keys").where("user_key", "==", user_key).limit(1).get();

    if (keysSnapshot.empty) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: false, reason: "Invalid key" }),
      };
    }

    const keyDoc = keysSnapshot.docs[0];
    const keyData = keyDoc.data();
    const keyId = keyDoc.id;

    if (keyData.status === false) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: false, reason: "Key is banned" }),
      };
    }

    const now = Date.now();
    if (keyData.expired_date && now > keyData.expired_date) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: false, reason: "Key is expired" }),
      };
    }

    const devicesSnapshot = await db.collection("devices").where("key_id", "==", keyId).get();
    const existingDevices = devicesSnapshot.docs;
    const deviceExists = existingDevices.some((doc) => doc.data().serial === serial);

    if (!deviceExists) {
      if (existingDevices.length >= (keyData.max_devices || 3)) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ status: false, reason: "Device limit reached" }),
        };
      }

      await db.collection("devices").add({
        key_id: keyId,
        serial: serial,
        created_at: now,
      });

      await db.collection("keys").doc(keyId).update({
        device_count: existingDevices.length + 1,
      });
    }

    const token = md5(`${game}-${user_key}-${serial}-${SECRET}`);

    const expStr = keyData.expired_date
      ? new Date(keyData.expired_date).toISOString()
      : "never";

    const responseBody = JSON.stringify({
      status: true,
      data: {
        token: token,
        rng: now,
        EXP: expStr,
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: responseBody,
    };
  } catch (err) {
    const safeMsg = (err.message || "Unknown error").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: false, reason: "Internal server error: " + safeMsg }),
    };
  }
};
