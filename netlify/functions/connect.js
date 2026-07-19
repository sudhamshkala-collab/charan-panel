const https = require("https");
const crypto = require("crypto");

const FIREBASE_PROJECT = "jeedimetla-charan";
const FIREBASE_API_KEY = "";
const SECRET = "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E";

let accessToken = null;
let tokenExpiry = 0;

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < tokenExpiry) {
      return resolve(accessToken);
    }
    
    let sa;
    try {
      sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    } catch (e) {
      return reject(new Error("Invalid service account: " + e.message));
    }
    
    if (!sa.client_email || !sa.private_key) {
      return reject(new Error("Missing client_email or private_key"));
    }
    
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })).toString("base64url");
    
    const unsignedJwt = header + "." + payload;
    const sign = crypto.sign("RSA-SHA256", Buffer.from(unsignedJwt), sa.private_key);
    const jwt = unsignedJwt + "." + sign.toString("base64url");
    
    const postData = "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt;
    
    const req = https.request({
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            accessToken = parsed.access_token;
            tokenExpiry = Date.now() + (parsed.expires_in - 60) * 1000;
            resolve(accessToken);
          } else {
            reject(new Error("Token error: " + data));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function firestoreQuery(collection, field, value) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = await getAccessToken();
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}?orderBy=${field}&limit=1&key=`;
      
      const filter = {
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: "EQUAL",
              value: { stringValue: value },
            },
          },
          limit: 1,
        },
      };
      
      const apiUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;
      const postData = JSON.stringify(filter);
      
      const req = https.request({
        hostname: "firestore.googleapis.com",
        path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`,
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      }, (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => {
          try {
            const results = JSON.parse(data);
            const docs = results.filter(r => r.document);
            resolve(docs.map(d => ({
              id: d.document.name.split("/").pop(),
              data: flattenDoc(d.document.fields),
            })));
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on("error", reject);
      req.write(postData);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function firestoreAdd(collection, fields) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = await getAccessToken();
      const firestoreFields = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === "number") {
          firestoreFields[k] = { integerValue: v };
        } else {
          firestoreFields[k] = { stringValue: String(v) };
        }
      }
      
      const postData = JSON.stringify({ fields: firestoreFields });
      
      const req = https.request({
        hostname: "firestore.googleapis.com",
        path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}`,
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      }, (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => {
          try {
            const doc = JSON.parse(data);
            resolve(doc.name.split("/").pop());
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on("error", reject);
      req.write(postData);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function firestoreUpdate(projectId, docPath, fields) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = await getAccessToken();
      const firestoreFields = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === "number") {
          firestoreFields[k] = { integerValue: v };
        } else {
          firestoreFields[k] = { stringValue: String(v) };
        }
      }
      
      const postData = JSON.stringify({ fields: firestoreFields });
      const updateMask = Object.keys(fields).map(f => "updateMask.fieldPaths=" + f).join("&");
      
      const req = https.request({
        hostname: "firestore.googleapis.com",
        path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${docPath}?${updateMask}`,
        method: "PATCH",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      }, (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => resolve());
      });
      
      req.on("error", reject);
      req.write(postData);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function flattenDoc(fields) {
  const result = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v.stringValue !== undefined) result[k] = v.stringValue;
    else if (v.integerValue !== undefined) result[k] = parseInt(v.integerValue);
    else if (v.doubleValue !== undefined) result[k] = v.doubleValue;
    else if (v.booleanValue !== undefined) result[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) result[k] = new Date(v.timestampValue).getTime();
    else result[k] = JSON.stringify(v);
  }
  return result;
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
    let game, user_key, serial;
    const rawBody = (event.body || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    let parsed = null;
    try { parsed = JSON.parse(rawBody || "{}"); } catch (e) { parsed = null; }

    if (parsed && typeof parsed === "object" && parsed.game !== undefined) {
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
        body: JSON.stringify({ status: false, reason: "Missing required fields" }),
      };
    }

    const keys = await firestoreQuery("keys", "user_key", user_key);

    if (keys.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: false, reason: "Invalid key" }),
      };
    }

    const keyData = keys[0].data;
    const keyId = keys[0].id;

    if (keyData.status === false || keyData.status === "false") {
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

    const devices = await firestoreQuery("devices", "key_id", keyId);
    const deviceExists = devices.some((d) => d.data.serial === serial);

    if (!deviceExists) {
      const maxDevices = keyData.max_devices || 3;
      if (devices.length >= maxDevices) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ status: false, reason: "Device limit reached" }),
        };
      }

      await firestoreAdd("devices", {
        key_id: keyId,
        serial: serial,
        created_at: now,
      });

      await firestoreUpdate(FIREBASE_PROJECT, `documents/keys/${keyId}`, {
        device_count: devices.length + 1,
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
          EXP: keyData.expired_date
            ? new Date(keyData.expired_date).toISOString()
            : "never",
        },
      }),
    };
  } catch (err) {
    const safeMsg = (err.message || "Unknown error").replace(/[\x00-\x1F]/g, " ");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: false, reason: "Internal server error: " + safeMsg }),
    };
  }
};
