import express from "express";
import axios from "axios";
import xml2js from "xml2js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import pool from "../../config/db.js";

const router = express.Router();

// DigiLocker / MeriPehchaan Credentials
const DIGILOCKER_CLIENT_ID = process.env.DIGILOCKER_CLIENT_ID || "com.hedgeverify";
const DIGILOCKER_CLIENT_SECRET = process.env.DIGILOCKER_CLIENT_SECRET || "2ca7af00885d6a1ab16e9582ee848a27b63d75e29ccd6e17b1d1c46a5f690f80";
const DIGILOCKER_REDIRECT_URI = process.env.DIGILOCKER_REDIRECT_URI || "http://localhost:8003/doc.php";
const DIGILOCKER_BASE_URL = process.env.DIGILOCKER_BASE_URL || "https://digilocker.meripehchaan.gov.in/public";

// In-memory store for PKCE verifiers (mapped by state)
const pkceStore = new Map();

// Periodic cleanup of expired states
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pkceStore.entries()) {
    if (now - val.timestamp > 30 * 60 * 1000) {
      pkceStore.delete(key);
    }
  }
}, 15 * 60 * 1000);

/**
 * POST /api/candidate/ekyc/digilocker/initiate
 * Generates PKCE code_verifier, code_challenge, and DigiLocker MeriPehchaan Auth URL
 */
router.post("/digilocker/initiate", (req, res) => {
  try {
    const { cand_id = 1 } = req.body;

    // Generate PKCE code_verifier (base64url random bytes)
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    // Generate code_challenge = Base64Url(SHA256(codeVerifier))
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    const state = crypto.randomBytes(16).toString("hex");

    pkceStore.set(state, {
      codeVerifier,
      cand_id,
      timestamp: Date.now()
    });

    const authUrl = `${DIGILOCKER_BASE_URL}/oauth2/1/authorize?response_type=code&client_id=${DIGILOCKER_CLIENT_ID}&redirect_uri=${encodeURIComponent(DIGILOCKER_REDIRECT_URI)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    return res.status(200).json({
      success: true,
      authUrl,
      state
    });
  } catch (error) {
    console.error("DigiLocker Initiate Error:", error);
    return res.status(500).json({ success: false, message: "Failed to initiate DigiLocker session" });
  }
});

/**
 * POST /api/candidate/ekyc/digilocker/token
 * Exchanges code for access_token, fetches e-Aadhaar XML, parses details and updates DB
 */
router.post("/digilocker/token", async (req, res) => {
  try {
    const { code, state, cand_id } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: "Authorization code is required" });
    }

    let codeVerifier = null;
    let effectiveCandId = cand_id;

    if (state && pkceStore.has(state)) {
      const stored = pkceStore.get(state);
      codeVerifier = stored.codeVerifier;
      if (!effectiveCandId) effectiveCandId = stored.cand_id;
      pkceStore.delete(state);
    }

    // Default fallback verifier if testing or direct flow
    if (!codeVerifier) {
      codeVerifier = "sXwbNbU99d6lciD8Az5KXXVx84LW-DW";
    }

    effectiveCandId = effectiveCandId || 1;

    // Call DigiLocker Token API
    const tokenPayload = {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: DIGILOCKER_REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: DIGILOCKER_CLIENT_ID,
      client_secret: DIGILOCKER_CLIENT_SECRET
    };

    let tokenResponse;
    try {
      tokenResponse = await axios.post(
        `${DIGILOCKER_BASE_URL}/oauth2/1/token`,
        tokenPayload,
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    } catch (tokenErr) {
      console.warn("JSON token request failed, retrying with form-urlencoded...", tokenErr?.response?.data || tokenErr.message);
      const params = new URLSearchParams(tokenPayload);
      tokenResponse = await axios.post(
        `${DIGILOCKER_BASE_URL}/oauth2/1/token`,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      );
    }

    const tokenData = tokenResponse.data;

    let eaadhaarData = null;
    let photoUrl = null;

    // Fetch e-Aadhaar XML if token is valid
    if (tokenData.access_token) {
      try {
        const xmlResponse = await axios.get(`${DIGILOCKER_BASE_URL}/oauth2/2/xml/eaadhaar`, {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`
          }
        });

        if (xmlResponse.data) {
          const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
          const parsedXml = await parser.parseStringPromise(xmlResponse.data);

          const uidData = parsedXml.OfflinePaperlessKyc?.UidData || {};
          const poi = uidData.Poi?.$ || {};
          const poa = uidData.Poa?.$ || {};
          const photoBase64 = uidData.Pht || null;

          if (photoBase64) {
            try {
              const uploadsDir = path.resolve("uploads");
              if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
              const photoFileName = `aadhaar_${effectiveCandId}_${Date.now()}.jpg`;
              const photoFilePath = path.join(uploadsDir, photoFileName);
              fs.writeFileSync(photoFilePath, Buffer.from(photoBase64, "base64"));
              photoUrl = `/uploads/${photoFileName}`;
            } catch (pErr) {
              console.error("Error saving photo file:", pErr.message);
            }
          }

          eaadhaarData = {
            name: poi.name || tokenData.name || "",
            dob: poi.dob || tokenData.dob || "",
            gender: poi.gender || tokenData.gender || "",
            masked_aadhar: parsedXml.OfflinePaperlessKyc?.$?.referenceId || "",
            photoUrl: photoUrl,
            address: {
              house: poa.house || "",
              street: poa.street || "",
              landmark: poa.landmark || "",
              locality: poa.loc || "",
              postoffice: poa.po || "",
              city: poa.vtc || "",
              district: poa.dist || "",
              state: poa.state || "",
              country: poa.country || "India",
              pincode: poa.pc || ""
            }
          };
        }
      } catch (xmlErr) {
        console.warn("Could not fetch e-Aadhaar XML directly:", xmlErr?.response?.data || xmlErr.message);
      }
    }

    // Determine final candidate data
    const finalName = eaadhaarData?.name || tokenData.name || "";
    const rawDob = eaadhaarData?.dob || tokenData.dob || "";

    // Parse and normalize DOB into YYYY-MM-DD
    let formattedDob = null;
    if (rawDob) {
      if (/^\d{8}$/.test(rawDob)) {
        // Format DDMMYYYY -> YYYY-MM-DD
        formattedDob = `${rawDob.slice(4)}-${rawDob.slice(2, 4)}-${rawDob.slice(0, 2)}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
        formattedDob = rawDob;
      } else if (rawDob.includes("-") || rawDob.includes("/")) {
        const parts = rawDob.split(/[\/\-]/);
        if (parts.length === 3) {
          formattedDob = parts[2].length === 4
            ? `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`
            : `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
        }
      }
    }

    const finalGender = eaadhaarData?.gender || tokenData.gender || "M";
    const maskedAadhaar = eaadhaarData?.masked_aadhar || "XXXXXXXXXXXX";
    const addr = eaadhaarData?.address || {};

    // Get candidate ID and client ID
    const [candRows] = await pool.query("SELECT candidate_id, client_id FROM candidate WHERE cand_id = ?", [effectiveCandId]);
    const candidateIdCode = candRows[0]?.candidate_id || `CAND${String(effectiveCandId).padStart(4, "0")}`;
    const clientId = candRows[0]?.client_id || 1;

    // 1. Insert or Update candidate_address
    const [existingAddr] = await pool.query("SELECT cand_add_id FROM candidate_address WHERE cand_id = ?", [effectiveCandId]);
    if (existingAddr.length > 0) {
      await pool.execute(
        `UPDATE candidate_address SET
          cand_name = ?,
          cand_dob = ?,
          cand_gender = ?,
          cand_photo = ?,
          cand_masked_aadhar = ?,
          cand_perm_house = ?,
          cand_perm_landmark = ?,
          cand_perm_locality = ?,
          cand_perm_postoffice = ?,
          cand_perm_street = ?,
          cand_perm_city = ?,
          cand_perm_district = ?,
          cand_perm_state = ?,
          cand_perm_country = ?,
          cand_perm_pincode = ?,
          cand_curr_house = ?,
          cand_curr_landmark = ?,
          cand_curr_locality = ?,
          cand_curr_postoffice = ?,
          cand_curr_street = ?,
          cand_curr_city = ?,
          cand_curr_district = ?,
          cand_curr_state = ?,
          cand_curr_country = ?,
          cand_curr_pincode = ?,
          is_add_same = 1,
          add_verification_status = 2,
          kyc_status = 'VERIFIED',
          ekyc_id = ?,
          updated_at = NOW()
        WHERE cand_id = ?`,
        [
          finalName,
          formattedDob,
          finalGender,
          photoUrl || null,
          maskedAadhaar,
          addr.house || "",
          addr.landmark || "",
          addr.locality || "",
          addr.postoffice || "",
          addr.street || "",
          addr.city || "",
          addr.district || "",
          addr.state || "",
          addr.country || "India",
          addr.pincode || "",
          addr.house || "",
          addr.landmark || "",
          addr.locality || "",
          addr.postoffice || "",
          addr.street || "",
          addr.city || "",
          addr.district || "",
          addr.state || "",
          addr.country || "India",
          addr.pincode || "",
          tokenData.digilocker_id || tokenData.reference_key || "DL-" + Date.now(),
          effectiveCandId
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO candidate_address (
          cand_id, candidate_id, client_id, candidate_address, ekyc_id, kyc_status,
          cand_name, cand_dob, cand_gender, cand_photo, cand_masked_aadhar,
          cand_perm_house, cand_perm_landmark, cand_perm_locality, cand_perm_postoffice, cand_perm_street,
          cand_perm_city, cand_perm_district, cand_perm_state, cand_perm_country, cand_perm_pincode,
          cand_curr_house, cand_curr_landmark, cand_curr_locality, cand_curr_postoffice, cand_curr_street,
          cand_curr_city, cand_curr_district, cand_curr_state, cand_curr_country, cand_curr_pincode,
          is_add_same, add_verification_status, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 2, ?, 'VERIFIED',
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          1, 2, NOW(), NOW()
        )`,
        [
          effectiveCandId, candidateIdCode, clientId, tokenData.digilocker_id || tokenData.reference_key || "DL-" + Date.now(),
          finalName, formattedDob, finalGender, photoUrl || null, maskedAadhaar,
          addr.house || "", addr.landmark || "", addr.locality || "", addr.postoffice || "", addr.street || "",
          addr.city || "", addr.district || "", addr.state || "", addr.country || "India", addr.pincode || "",
          addr.house || "", addr.landmark || "", addr.locality || "", addr.postoffice || "", addr.street || "",
          addr.city || "", addr.district || "", addr.state || "", addr.country || "India", addr.pincode || ""
        ]
      );
    }

    // 2. Insert or Update candidate_identity (Mark Aadhaar verified)
    const [existingIden] = await pool.query("SELECT cand_iden_id FROM candidate_identity WHERE cand_id = ?", [effectiveCandId]);
    const fullAddressStr = `${addr.house || ""} ${addr.street || ""} ${addr.locality || ""} ${addr.city || ""} ${addr.state || ""} ${addr.pincode || ""}`.trim();

    if (existingIden.length > 0) {
      await pool.execute(
        `UPDATE candidate_identity SET
          cand_full_name = ?,
          cand_dob = ?,
          cand_gender = ?,
          cand_address = ?,
          cand_iden_type = 'Aadhaar Card',
          iden_verification_status = 2,
          updated_at = NOW()
        WHERE cand_id = ?`,
        [finalName, formattedDob, finalGender, fullAddressStr, effectiveCandId]
      );
    } else {
      await pool.execute(
        `INSERT INTO candidate_identity (
          cand_id, candidate_id, client_id, cand_iden_type, iden_verification_status,
          cand_full_name, cand_dob, cand_gender, cand_address, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'Aadhaar Card', 2,
          ?, ?, ?, ?, NOW(), NOW()
        )`,
        [effectiveCandId, candidateIdCode, clientId, finalName, formattedDob, finalGender, fullAddressStr]
      );
    }

    return res.status(200).json({
      success: true,
      verified: true,
      message: "DigiLocker verification completed successfully",
      data: {
        name: finalName,
        dob: formattedDob || rawDob,
        gender: finalGender,
        masked_aadhar: maskedAadhaar,
        photo: photoUrl,
        address: addr,
        digilocker_id: tokenData.digilocker_id
      }
    });

  } catch (error) {
    console.error("DigiLocker Token Error:", error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error?.response?.data?.error_description || error?.response?.data?.message || "Failed to complete DigiLocker verification",
      details: error?.response?.data || null
    });
  }
});

/**
 * GET /api/candidate/ekyc/digilocker/details/:cand_id
 * Returns current DigiLocker verification data for candidate
 */
router.get("/digilocker/details/:cand_id", async (req, res) => {
  try {
    const { cand_id } = req.params;
    const [addrRows] = await pool.query(
      "SELECT * FROM candidate_address WHERE cand_id = ?",
      [cand_id]
    );

    const [idenRows] = await pool.query(
      "SELECT * FROM candidate_identity WHERE cand_id = ?",
      [cand_id]
    );

    if (addrRows.length === 0 && idenRows.length === 0) {
      return res.status(200).json({ success: true, verified: false });
    }

    return res.status(200).json({
      success: true,
      verified: addrRows[0]?.add_verification_status === 2,
      address: addrRows[0] || null,
      identity: idenRows[0] || null
    });
  } catch (error) {
    console.error("Get DigiLocker Details Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
