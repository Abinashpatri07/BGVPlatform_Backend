import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";


// ───────── SUPER ADMIN ─────────
import authRoutes from "./routes/superadminroute/authRoutes.js";
import clientRoutes from "./routes/superadminroute/clientRoutes.js";
import hrRoutes from "./routes/superadminroute/hrRoutes.js";
import vendorRoutes from "./routes/superadminroute/vendorRoutes.js";
import candidateRoutes from "./routes/superadminroute/candidateRoutes.js";
import auditRoutes from "./routes/superadminroute/auditRoutes.js";
import dashboardRoutes from "./routes/superadminroute/dashboardRoutes.js";
import superAdminBillingRoutes from "./routes/superadminroute/billingRoutes.js";

// ───────── CLIENT ADMIN ─────────
import clientAdminHrRoutes from "./routes/clientadminroute/hrRoutes.js";
import clientAdminCandidateRoutes from "./routes/clientadminroute/candidateRoutes.js";
import clientAdminAuthRoutes from "./routes/clientadminroute/authRoutes.js";
import clientAdminDashboardRoutes from "./routes/clientadminroute/dashboardRoutes.js";
import clientAdminBillingRoutes from "./routes/clientadminroute/billingRoutes.js";

// ───────── HR ─────────
import hrAuthRoutes from "./routes/hrroute/authRoutes.js";
import hrCandidateRoutes from "./routes/hrroute/candidateRoutes.js";
import hrTableRoutes from "./routes/hrroute/tableRoutes.js";

// ───────── VENDOR ─────────
import vendorAuthRoutes from "./routes/vendorroute/authRoutes.js";

// ───────── CANDIDATE ─────────
import candidateSubmissionRoutes from "./routes/candidateroute/submissionRoutes.js";
import candidateAuthRoutes from "./routes/candidateroute/authRoutes.js";
import candidateEkycRoutes from "./routes/candidateroute/ekycRoutes.js";

// ───────── OCR ─────────
import ocrRoutes from "./routes/ocrRoutes.js";

dotenv.config();

import pool from "./config/db.js";

const app = express();

/* MIDDLEWARE */
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174", "https://bgv-platformdemo.vercel.app"],
  credentials: true,
}));
app.use(express.json());

/* SWAGGER DOCS */
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/* SWAGGER JSON EXPORT — SwaggerHub upload ke liye */
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

/* ───────── CANDIDATE SUBMISSION ROUTES (Must be before Super Admin /api/candidate) ───────── */
app.use("/api/candidate/submit", candidateSubmissionRoutes);
app.use("/api/candidate/auth", candidateAuthRoutes);
app.use("/api/candidate/ekyc", candidateEkycRoutes);

/* ───────── HR ROUTES (Must be before Super Admin /api/hr) ───────── */
app.use("/api/hr/auth", hrAuthRoutes);
app.use("/api/candidates", hrCandidateRoutes);
app.use("/api/candidates/table", hrTableRoutes);

/* ───────── SUPER ADMIN ROUTES ───────── */

app.use("/api/auth", authRoutes);

app.use("/api/client", clientRoutes);

app.use("/api/hr", hrRoutes);

app.use("/api/vendor", vendorRoutes);

app.use("/api/candidate", candidateRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/billing", superAdminBillingRoutes);

/* ───────── CLIENT ADMIN ROUTES ───────── */

app.use("/api/client-admin/hr", clientAdminHrRoutes);
app.use(
  "/api/client-admin/candidate",
  clientAdminCandidateRoutes
);
app.use(
  "/api/client-admin/auth",
  clientAdminAuthRoutes
);
app.use("/api/client-admin/dashboard", clientAdminDashboardRoutes);
app.use("/api/client-admin/billing", clientAdminBillingRoutes);

/* ───────── VENDOR ROUTES ───────── */
app.use("/api/vendor/auth", vendorAuthRoutes);





/* ───────── OCR ROUTES ───────── */
app.use("/api/ocr", ocrRoutes);

/* TEST */
app.get("/", (req, res) => {
  res.send("Backend Server Running 🚀");
});

/* PORT */
const PORT = process.env.PORT || 5000;

pool.getConnection()
  .then(() => {
    console.log("MariaDB Connected ✅");
  })
  .catch((err) => {
    console.log("DB Connection Error ❌", err);
  });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});