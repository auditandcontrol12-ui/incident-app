const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");

const connectionString = process.env.BLOB_STORAGE_CONNECTION_STRING;
const containerName = process.env.STN_SIGNED_CONTAINER;

function getBlobContainerClient() {
  if (!connectionString) {
    throw new Error("BLOB_STORAGE_CONNECTION_STRING is not configured.");
  }

  if (!containerName) {
    throw new Error("STN_SIGNED_CONTAINER is not configured.");
  }

  return BlobServiceClient
    .fromConnectionString(connectionString)
    .getContainerClient(containerName);
}

function sanitizeFileName(fileName = "file") {
  const ext = path.extname(fileName || "");
  const base = path.basename(fileName || "file", ext);
  const safeBase = base.replace(/[^a-zA-Z0-9-_]/g, "_");
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
  return `${safeBase}${safeExt}`;
}

function buildBlobPath({ incidentNumber, fileName }) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeFileName = sanitizeFileName(fileName);

  return `incidents/${yyyy}/${mm}/${dd}/${incidentNumber}/${Date.now()}_${safeFileName}`;
}

async function uploadBufferToBlob({ buffer, blobPath, contentType }) {
  const containerClient = getBlobContainerClient();

  await containerClient.createIfNotExists();

  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType || "application/octet-stream"
    }
  });

  return {
    blobPath,
    blobUrl: blockBlobClient.url
  };
}

async function deleteBlobIfExists(blobPath) {
  if (!blobPath) return;

  const containerClient = getBlobContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  await blockBlobClient.deleteIfExists();
}

module.exports = {
  getBlobContainerClient,
  sanitizeFileName,
  buildBlobPath,
  uploadBufferToBlob,
  deleteBlobIfExists
};