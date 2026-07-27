async function run() {
  try {
    const res = await fetch("http://localhost:5000/api/candidate/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" })
    });
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text.substring(0, 100));
  } catch (err) {
    console.error("Fetch error:", err.message);
  }
}
run();
