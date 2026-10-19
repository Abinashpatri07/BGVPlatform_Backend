import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Configure Cloudinary if credentials are present
const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// 1. Cloudinary Storage
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    const nameWithoutExt = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, "_");
    return {
      folder: "bgv_uploads",
      resource_type: isPdf ? "raw" : "auto",
      public_id: `${nameWithoutExt}_${Date.now()}`,
    };
  },
});

// 2. Local Disk Storage (Fallback if Cloudinary not set)
const localUploadsDir = path.resolve("uploads");
if (!fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `candidate_emp_${Date.now()}${ext}`);
  },
});

export const getUploadStorage = () => {
  return isCloudinaryConfigured ? cloudinaryStorage : diskStorage;
};

export const getUploadedFilePath = (fileOrPath) => {
  if (!fileOrPath) return null;
  const rawPath = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
  if (!rawPath) return null;
  // If uploaded to Cloudinary or full URL
  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    return rawPath;
  }
  // Standardize disk storage path with forward slash
  const cleanPath = rawPath.replace(/\\/g, "/");
  return cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath;
};

export { cloudinary, isCloudinaryConfigured };
