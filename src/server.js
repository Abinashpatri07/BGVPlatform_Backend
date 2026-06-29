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

// ───────── CLIENT ADMIN ─────────
import clientAdminHrRoutes from "./routes/clientadminroute/hrRoutes.js";
import clientAdminCandidateRoutes from "./routes/clientadminroute/candidateRoutes.js";
import clientAdminAuthRoutes from "./routes/clientadminroute/authRoutes.js";
import clientAdminDashboardRoutes from "./routes/clientadminroute/dashboardRoutes.js";

// ───────── HR ─────────
import hrAuthRoutes from "./routes/hrroute/authRoutes.js";
import hrCandidateRoutes from "./routes/hrroute/candidateRoutes.js";
import hrTableRoutes from "./routes/hrroute/tableRoutes.js";

dotenv.config();

import pool from "./config/db.js";

const app = express();

/* MIDDLEWARE */
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174"],
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

/* ───────── SUPER ADMIN ROUTES ───────── */

app.use("/api/auth", authRoutes);

app.use("/api/client", clientRoutes);

app.use("/api/hr", hrRoutes);

app.use("/api/vendor", vendorRoutes);

app.use("/api/candidate", candidateRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/dashboard", dashboardRoutes);

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

/* ───────── HR ROUTES ───────── */

app.use("/api/hr/auth", hrAuthRoutes);
app.use("/api/candidates", hrCandidateRoutes);
app.use("/api/candidates/table", hrTableRoutes);

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});