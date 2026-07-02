import express from 'express';
import multer from 'multer';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// UNIVERSAL OCR EXTRACTION ENDPOINT
router.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { docType } = req.body;
    let endpoint = "";

    // Map docType to IDfy Endpoint
    if (docType === "PAN card") {
      endpoint = "https://eve.idfy.com/v3/tasks/sync/extract/ind_pan";
    } else if (docType === "Voter ID") {
      endpoint = "https://eve.idfy.com/v3/tasks/sync/extract/ind_voter_id";
    } else if (docType === "Driving license") {
      endpoint = "https://eve.idfy.com/v3/tasks/sync/extract/ind_driving_license";
    } else if (docType === "Passport") {
      endpoint = "https://eve.idfy.com/v3/tasks/sync/extract/ind_passport";
    } else if (docType === "Salary Slip") {
      endpoint = "https://eve.idfy.com/v3/tasks/sync/extract/id_document";
    } else {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const base64Data = req.file.buffer.toString('base64');
    
    const payload = {
      task_id: "sync_extract_" + Date.now(),
      group_id: "bgv_group",
      data: {
        document1: base64Data
      }
    };

    if (docType === "Salary Slip") {
      payload.data.doc_type = "pay_slip";
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("IDfy API Error:", error);
    res.status(500).json({ error: 'Failed to process OCR' });
  }
});

// 3. POLLING ENDPOINT FOR ASYNC TASKS
router.get('/status/:request_id', async (req, res) => {
  try {
    const { request_id } = req.params;

    const response = await fetch(`https://eve.idfy.com/v3/tasks?request_id=${request_id}`, {
      method: "GET",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841"
      }
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("IDfy Status API Error:", error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// 4. AADHAAR OKYC: GENERATE OTP
router.post('/aadhaar/generate-otp', express.json(), async (req, res) => {
  try {
    const { aadhaarNumber } = req.body;
    if (!aadhaarNumber) {
      return res.status(400).json({ error: 'Aadhaar number is required' });
    }

    const taskId = "aadhaar_otp_" + Date.now();
    const payload = {
      task_id: taskId,
      group_id: "bgv_group",
      data: {
        id_number: aadhaarNumber
      }
    };

    const response = await fetch("https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_aadhaar", {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.json({ ...data, task_id: taskId });
  } catch (error) {
    console.error("IDfy Aadhaar Generate Error:", error);
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

// 5. AADHAAR OKYC: VERIFY OTP
router.post('/aadhaar/verify-otp', express.json(), async (req, res) => {
  try {
    const { otp, taskId } = req.body;
    if (!otp || !taskId) {
      return res.status(400).json({ error: 'OTP and Task ID are required' });
    }

    const payload = {
      task_id: taskId, // Must use the same task_id
      group_id: "bgv_group",
      data: {
        otp: otp
      }
    };

    const response = await fetch("https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_aadhaar_otp", {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("IDfy Aadhaar Verify Error:", error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// 6. PAN SOURCE VERIFICATION
router.post('/verify-pan', express.json(), async (req, res) => {
  try {
    const { panNumber, fullName, dob } = req.body;
    if (!panNumber) {
      return res.status(400).json({ error: 'PAN number is required' });
    }

    const taskId = "pan_verify_" + Date.now();
    const payload = {
      task_id: taskId,
      group_id: "bgv_group",
      data: {
        id_number: panNumber,
        full_name: fullName || "",
        dob: dob || ""
      }
    };

    const response = await fetch("https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_pan", {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("IDfy PAN Verify Error:", error);
    res.status(500).json({ error: 'Failed to initiate PAN verification' });
  }
});

// 7. DRIVING LICENSE SOURCE VERIFICATION
router.post('/verify-dl', express.json(), async (req, res) => {
  try {
    const { dlNumber, dob } = req.body;
    if (!dlNumber) return res.status(400).json({ error: 'DL number is required' });

    const payload = {
      task_id: "dl_verify_" + Date.now(),
      group_id: "bgv_group",
      data: { 
        id_number: dlNumber, 
        date_of_birth: dob || "",
        advanced_details: {
          state_info: true,
          age_info: true
        }
      }
    };

    const response = await fetch("https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_driving_license", {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    res.json(await response.json());
  } catch (error) {
    console.error("IDfy DL Verify Error:", error);
    res.status(500).json({ error: 'Failed to initiate DL verification' });
  }
});

// 8. VOTER ID SOURCE VERIFICATION
router.post('/verify-voter', express.json(), async (req, res) => {
  try {
    const { epicNumber } = req.body;
    if (!epicNumber) return res.status(400).json({ error: 'Voter ID number is required' });

    const payload = {
      task_id: "voter_verify_" + Date.now(),
      group_id: "bgv_group",
      data: { id_number: epicNumber }
    };

    const response = await fetch("https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_voter_id", {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    res.json(await response.json());
  } catch (error) {
    console.error("IDfy Voter Verify Error:", error);
    res.status(500).json({ error: 'Failed to initiate Voter ID verification' });
  }
});

// 9. PASSPORT SOURCE VERIFICATION
router.post('/verify-passport', express.json(), async (req, res) => {
  try {
    const { fileNumber, dob, name } = req.body;
    if (!fileNumber) return res.status(400).json({ error: 'Passport file number is required' });

    const payload = {
      task_id: "passport_verify_" + Date.now(),
      group_id: "bgv_group",
      data: { 
        passport_file_number: fileNumber,
        date_of_birth: dob || ""
      }
    };

    const response = await fetch("https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_passport", {
      method: "POST",
      headers: {
        "account-id": "b61986deab6c/4297bc7e-dea5-422b-b1bf-9255dbeb9736",
        "api-key": "7de4e754-67c1-4d7f-963a-5a8203ceb841",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    res.json(await response.json());
  } catch (error) {
    console.error("IDfy Passport Verify Error:", error);
    res.status(500).json({ error: 'Failed to initiate Passport verification' });
  }
});

export default router;
