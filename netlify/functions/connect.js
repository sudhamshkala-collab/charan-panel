const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
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
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ status: false, reason: "Method not allowed" }),
    };
  }

  try {
    let game, user_key, serial;
    const contentType = (event.headers["content-type"] || "").toLowerCase();

    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(event.body || "{}");
      game = parsed.game;
      user_key = parsed.user_key;
      serial = parsed.serial;
    } else {
      const params = new URLSearchParams(event.body || "");
      game = params.get("game");
      user_key = params.get("user_key");
      serial = params.get("serial");
    }

    if (!game || !user_key || !serial) {
      return {
        statusCode: 400,
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

    if (!keyData.status) {
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
      if (existingDevices.length >= keyData.max_devices) {
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

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: true,
        data: {
          token: token,
          rng: now,
          EXP: keyData.expired_date ? new Date(keyData.expired_date).toISOString() : "never",
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: false, reason: "Internal server error: " + err.message }),
    };
  }
};
