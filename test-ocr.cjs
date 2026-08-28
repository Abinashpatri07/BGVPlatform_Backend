const axios = require('axios');
axios.post('http://localhost:5000/api/ocr/aadhaar/generate-otp', {
  aadhaarNumber: "111122223333"
}).then(res => console.log("SUCCESS:", res.data))
  .catch(err => console.log("ERROR:", err.response ? err.response.data : err.message));
