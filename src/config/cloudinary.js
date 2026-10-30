import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Local / Persistent Disk Storage — uploads folder se serve
const localUploadsDir = path.resolve("uploads");
if (!fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    // Always preserve correct extension so browsers can preview properly
    const ext = path.extname(file.originalname) || (isPdf ? ".pdf" : "");
    cb(null, `bgv_${Date.now()}${ext}`);
  },
});

/**
 * ALWAYS use local / persistent disk storage.
 * Files are served via: /uploads/<filename>
 */
export const getUploadStorage = () => {
  return diskStorage;
};

/**
 * Returns the relative stored path (e.g. "uploads/bgv_xxx.pdf")
 * for local files, or the full URL for externally hosted files.
 */
export const getUploadedFilePath = (fileOrPath) => {
  if (!fileOrPath) return null;
  const rawPath =
    typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
  if (!rawPath) return null;
  // Already a full URL (external)
  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    return rawPath;
  }
  // Normalize backslashes → forward slashes (Windows dev)
  const cleanPath = rawPath.replace(/\\/g, "/");
  return cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath;
};

export const isCloudinaryConfigured = false;
