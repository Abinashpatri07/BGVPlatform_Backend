import express from "express";
import axios from "axios";
import xml2js from "xml2js";
import pool from "../../config/db.js";

const router = express.Router();

// Mock Sandbox Credentials (If you have real ones, put them in .env)
const SETU_CLIENT_ID = process.env.SETU_CLIENT_ID || 'dummy_client_id';
const SETU_CLIENT_SECRET = process.env.SETU_CLIENT_SECRET || 'dummy_client_secret';
const SETU_PRODUCT_INSTANCE_ID = process.env.SETU_PRODUCT_INSTANCE_ID || 'dummy_instance_id';

/**
 * POST /api/candidate/ekyc/initiate
 * Initiates an eKYC request and returns the kycURL and id.
 */
router.post("/initiate", async (req, res) => {
  try {
    const payload = {
      redirectURL: "http://localhost:5173/candidate/verification" // Will be passed from frontend later if dynamic
    };

    // Override redirectURL if sent from frontend
    if (req.body.redirectURL) {
      payload.redirectURL = req.body.redirectURL;
    }

    const response = await axios.post("https://dg-sandbox.setu.co/api/ekyc", payload, {
      headers: {
        "x-client-id": SETU_CLIENT_ID,
        "x-client-secret": SETU_CLIENT_SECRET,
        "x-product-instance-id": SETU_PRODUCT_INSTANCE_ID,
        "Content-Type": "application/json"
      }
    });

    if (response.data && response.data.id && response.data.kycURL) {
      return res.status(200).json({
        success: true,
        id: response.data.id,
        kycURL: response.data.kycURL
      });
    } else {
      return res.status(400).json({ success: false, message: "Failed to initiate eKYC", data: response.data });
    }
  } catch (error) {
    console.error("eKYC Initiate Error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/candidate/ekyc/status
 * Fetches the status and parsed data of an eKYC request using the id.
 */
router.get("/status", async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, message: "Missing eKYC ID" });
    }

    const response = await axios.get(`https://dg-sandbox.setu.co/api/ekyc/${id}`, {
      headers: {
        "x-client-id": SETU_CLIENT_ID,
        "x-client-secret": SETU_CLIENT_SECRET,
        "x-product-instance-id": SETU_PRODUCT_INSTANCE_ID
      }
    });

    const statusData = response.data;
    
    if (statusData.status === "SUCCESS" && statusData.xml && statusData.xml.xmlBase64) {
      // Decode Base64 XML
      const xmlString = Buffer.from(statusData.xml.xmlBase64, 'base64').toString('utf8');
      
      // Parse XML
      const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
      const result = await parser.parseStringPromise(xmlString);
      
      // Aadhaar XML structure usually has OfflinePaperlessKyc -> UidData -> Poi / Poa
      let uidData = result.OfflinePaperlessKyc?.UidData || {};
      let poi = uidData.Poi?.$ || {}; // Personal Info attributes
      let poa = uidData.Poa?.$ || {}; // Address Info attributes
      
      let photoBase64 = uidData.Pht || null;

      const parsedData = {
        name: poi.name || "",
        dob: poi.dob || "",
        gender: poi.gender || "", 
        masked_aadhar: statusData.identity?.aadhaarNumber || "", 
        photo: photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : "",
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

      return res.status(200).json({ success: true, status: "SUCCESS", data: parsedData });
    } else {
      return res.status(200).json({ success: true, status: statusData.status || "PENDING" });
    }
  } catch (error) {
    console.error("eKYC Status Error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Internal server error while fetching status" });
  }
});

export default router;
