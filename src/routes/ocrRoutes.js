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

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "account-id": "99e89415cf22/eb681f49-3240-44a7-9a7d-e5bf7619e607",
        "api-key": "1e071554-8681-4f0d-b09e-814b9450e669",
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
        "account-id": "99e89415cf22/eb681f49-3240-44a7-9a7d-e5bf7619e607",
        "api-key": "1e071554-8681-4f0d-b09e-814b9450e669"
      }
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("IDfy Status API Error:", error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

export default router;
