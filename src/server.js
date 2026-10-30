import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";


// ───────── UNIFIED AUTH ─────────
import unifiedAuthRoutes from "./routes/unifiedAuthRoutes.js";

// ───────── SUPER ADMIN ─────────
import authRoutes from "./routes/superadminroute/authRoutes.js";
import clientRoutes from "./routes/superadminroute/clientRoutes.js";
import hrRoutes from "./routes/superadminroute/hrRoutes.js";
import vendorRoutes from "./routes/superadminroute/vendorRoutes.js";
import candidateRoutes from "./routes/superadminroute/candidateRoutes.js";
import auditRoutes from "./routes/superadminroute/auditRoutes.js";
import dashboardRoutes from "./routes/superadminroute/dashboardRoutes.js";
import superAdminBillingRoutes from "./routes/superadminroute/billingRoutes.js";
import superAdminCaseRoutes from "./routes/superadminroute/caseRoutes.js";
import superAdminAnalyticsRoutes from "./routes/superadminroute/analyticsRoutes.js";

// ───────── CLIENT ADMIN ─────────
import clientAdminHrRoutes from "./routes/clientadminroute/hrRoutes.js";
import clientAdminCandidateRoutes from "./routes/clientadminroute/candidateRoutes.js";
import clientAdminAuthRoutes from "./routes/clientadminroute/authRoutes.js";
import clientAdminDashboardRoutes from "./routes/clientadminroute/dashboardRoutes.js";
import clientAdminBillingRoutes from "./routes/clientadminroute/billingRoutes.js";
import clientAdminAnalyticsRoutes from "./routes/clientadminroute/analyticsRoutes.js";

// ───────── HR ─────────
import hrAuthRoutes from "./routes/hrroute/authRoutes.js";
import hrCandidateRoutes from "./routes/hrroute/candidateRoutes.js";
import hrTableRoutes from "./routes/hrroute/tableRoutes.js";

// ───────── VENDOR ─────────
import vendorAuthRoutes from "./routes/vendorroute/authRoutes.js";
import vendorCaseRoutes from "./routes/vendorroute/caseRoutes.js";
import vendorBillingRoutes from "./routes/vendorroute/billingRoutes.js";

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
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://bgv.dqnex.online",
    "https://bgv.dqnex.online",
    "http://187.126.122.110",
    "http://187.126.122.110:5173",
    "http://187.126.122.110:5174",
  ],
  credentials: true,
}));
app.use(express.json());

const uploadsDirectory = path.resolve("uploads");
if (!fs.existsSync(uploadsDirectory)) {
  fs.mkdirSync(uploadsDirectory, { recursive: true });
}
// Serve uploads — images & PDFs accessible at /uploads/<filename>
app.use("/uploads", express.static(uploadsDirectory, {
  setHeaders: (res, filePath) => {
    // Allow browsers to display PDFs inline (not force download)
    if (filePath.endsWith(".pdf")) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
    }
  },
}));

// Fallback: If file is not present on local disk, proxy/stream it from the production server (Railway persistent storage)
app.use("/uploads", async (req, res, next) => {
  const remoteBase = (process.env.REMOTE_UPLOADS_URL || "https://api.dqnex.online").replace(/\/+$/, "");
  const remoteUrl = `${remoteBase}/uploads${req.path}`;
  try {
    const remoteRes = await fetch(remoteUrl);
    if (!remoteRes.ok) {
      return res.status(remoteRes.status).send("File not found");
    }
    const contentType = remoteRes.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    if (req.path.toLowerCase().endsWith(".pdf")) {
      res.setHeader("Content-Disposition", "inline");
    }
    const arrayBuffer = await remoteRes.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Uploads proxy error:", err.message);
    return res.status(404).send("File not found");
  }
});


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

/* ───────── UNIFIED AUTH ROUTES ───────── */
app.use("/api/auth", unifiedAuthRoutes);

/* ───────── VENDOR ROUTES (Must be before Super Admin /api/vendor) ───────── */
app.use("/api/vendor/auth", vendorAuthRoutes);
app.use("/api/vendor/cases", vendorCaseRoutes);
app.use("/api/vendor/billing", vendorBillingRoutes);

/* ───────── SUPER ADMIN ROUTES ───────── */

app.use("/api/auth", authRoutes);

app.use("/api/client", clientRoutes);

app.use("/api/hr", hrRoutes);

app.use("/api/vendor", vendorRoutes);

app.use("/api/candidate", candidateRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/billing", superAdminBillingRoutes);
app.use("/api/superadmin/cases", superAdminCaseRoutes);
app.use("/api/superadmin/analytics", superAdminAnalyticsRoutes);

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
app.use("/api/client-admin/analytics", clientAdminAnalyticsRoutes);





/* ───────── OCR ROUTES ───────── */
app.use("/api/ocr", ocrRoutes);

/* TEST */
app.get("/", (req, res) => {
  res.send("Backend Server Running 🚀");
});

/* ───────── FRONTEND RESET / SETUP REDIRECTS (FALLBACK) ───────── */
const passwordResetPaths = [
  "/reset-password",
  "/setup-password",
  "/admin/reset-password",
  "/admin/setup-password",
  "/admin/client-setup-password",
  "/client-setup-password",
  "/hr/reset-password",
  "/hr/setup-password",
  "/hr-setup-password",
  "/vendor/reset-password",
  "/vendor/setup-password",
  "/vendor-setup-password",
  "/candidate/reset-password",
  "/candidate/setup-password",
  "/super-admin/reset-password",
];

passwordResetPaths.forEach((routePath) => {
  app.get(routePath, (req, res) => {
    const isDev = req.hostname === "localhost" || req.hostname === "127.0.0.1";
    const frontendBase = isDev
      ? "http://localhost:5173"
      : (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost")
          ? process.env.FRONTEND_URL.replace(/\/+$/, "")
          : "https://bgv.dqnex.online");
    return res.redirect(`${frontendBase}${req.originalUrl}`);
  });
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

/* ───────── DIGILOCKER OAUTH BRIDGE (Port 8003) ───────── */
import http from "http";

const bridgeServer = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost:8003"}`);
    if (parsedUrl.pathname === "/doc.php") {
      const code = parsedUrl.searchParams.get("code");
      const state = parsedUrl.searchParams.get("state");
      const error = parsedUrl.searchParams.get("error");
      const error_description = parsedUrl.searchParams.get("error_description");
      const frontendBase = process.env.FRONTEND_URL || "http://localhost:5173";

      if (error) {
        res.writeHead(302, {
          Location: `${frontendBase}/candidate/digilocker/callback?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || "")}`
        });
        return res.end();
      }

      res.writeHead(302, {
        Location: `${frontendBase}/candidate/digilocker/callback?code=${encodeURIComponent(code || "")}&state=${encodeURIComponent(state || "")}`
      });
      return res.end();
    }
  } catch (err) {
    console.error("Bridge Error:", err);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

bridgeServer.listen(8003, "0.0.0.0", () => {
  console.log("DigiLocker OAuth Bridge running on port 8003 for /doc.php 🚀");
});
bridgeServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn("Port 8003 already in use by another process. Bridge server not started.");
  } else {
    console.error("Bridge server error:", err.message);
  }
});