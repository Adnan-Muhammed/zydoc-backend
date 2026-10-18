// src/infrastructure/services/S3StorageService.js
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { generateSecureFilename } from "../utils/fileValidator.js";
import fs from "fs";
import path from "path";

/**
 * Exact presigned URL expiry duration in seconds (15 minutes).
 * Enforced across all private file access operations.
 */
export const DEFAULT_PRESIGNED_EXPIRY_SECONDS = 900;

/**
 * Service providing S3 object storage operations, CloudFront public asset URL resolution,
 * and 900-second private presigned GET URL generation.
 */
export class S3StorageService {
  /**
   * @param {object} [options={}]
   * @param {S3Client} [options.s3Client] - Optional injected S3Client instance for tests
   * @param {Function} [options.getSignedUrlFn] - Optional presigner function for tests
   * @param {string} [options.region] - AWS Region (defaults to process.env.AWS_REGION or 'ap-south-1')
   * @param {string} [options.publicBucket] - S3 public assets bucket name
   * @param {string} [options.privateBucket] - S3 private files bucket name
   * @param {string} [options.cloudfrontDomain] - CloudFront distribution domain for public assets
   * @param {string} [options.driver] - Storage driver identifier (defaults to 's3')
   */
  constructor({
    s3Client = null,
    getSignedUrlFn = null,
    region = process.env.AWS_REGION || "ap-south-1",
    publicBucket = process.env.S3_PUBLIC_BUCKET || "zydoc-prod-public-assets-482731",
    privateBucket = process.env.S3_PRIVATE_BUCKET || "zydoc-prod-private-files-482731",
    cloudfrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN || "d2j3r11t01prca.cloudfront.net",
    driver = process.env.FILE_STORAGE_DRIVER || "s3",
  } = {}) {
    this.region = region;
    this.publicBucket = publicBucket;
    this.privateBucket = privateBucket;
    this.cloudfrontDomain = cloudfrontDomain;
    this.driver = driver;
    this._getSignedUrlFn = getSignedUrlFn || getSignedUrl;

    if (s3Client) {
      this.s3Client = s3Client;
    } else {
      const credentials =
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined;

      this.s3Client = new S3Client({
        region: this.region,
        ...(credentials && { credentials }),
      });
    }
  }

  /**
   * Returns true if S3 storage is configured with required bucket names.
   *
   * @returns {boolean}
   */
  isConfigured() {
    if (this.driver === "local") return false;
    return Boolean(this.publicBucket && this.privateBucket);
  }

  /**
   * Resolves the target S3 bucket name.
   *
   * @param {'public'|'private'|string} bucketTypeOrName - 'public', 'private', or specific bucket name
   * @returns {string} The resolved bucket name
   */
  resolveBucket(bucketTypeOrName = "private") {
    if (bucketTypeOrName === "public") {
      if (!this.publicBucket) throw new Error("Public S3 bucket is not configured.");
      return this.publicBucket;
    }
    if (bucketTypeOrName === "private") {
      if (!this.privateBucket) throw new Error("Private S3 bucket is not configured.");
      return this.privateBucket;
    }
    if (bucketTypeOrName === this.publicBucket || bucketTypeOrName === this.privateBucket) {
      return bucketTypeOrName;
    }
    throw new Error(`Invalid bucket type or name: "${bucketTypeOrName}". Expected "public" or "private".`);
  }

  /**
   * Generates a safe, unguessable S3 object key.
   * Uses cryptographically random UUIDs and sanitizes extensions.
   * Never uses client-provided filenames directly as object keys.
   *
   * @param {string} [prefix='file'] - Identifier prefix (e.g., 'avatar', 'rec', 'medcert', 'govid', 'qual')
   * @param {string} [originalName=''] - Original client filename used solely for extension derivation
   * @param {string} [folder=''] - Optional folder prefix (e.g., 'avatars', 'records')
   * @returns {string} Safe S3 object key
   */
  generateObjectKey(prefix = "file", originalName = "", folder = "") {
    const filename = generateSecureFilename(prefix, originalName);
    if (!folder) return filename;
    const cleanFolder = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return cleanFolder ? `${cleanFolder}/${filename}` : filename;
  }

  /**
   * Validates and sanitizes an object key to prevent directory traversal or malformed characters.
   *
   * @param {string} key
   * @returns {string} Sanitized object key
   */
  sanitizeObjectKey(key) {
    if (!key || typeof key !== "string") {
      throw new Error("Object key must be a non-empty string.");
    }
    const cleanKey = key.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (cleanKey.includes("..") || /[\0\r\n]/.test(cleanKey) || cleanKey.length === 0) {
      throw new Error("Invalid object key: path traversal or invalid characters detected.");
    }
    return cleanKey;
  }

  /**
   * Upload an object to the specified S3 bucket.
   *
   * @param {object} params
   * @param {'public'|'private'|string} [params.bucketType='private'] - Target bucket ('public' or 'private')
   * @param {Buffer|Uint8Array|string|ReadableStream} params.body - File payload content
   * @param {string} [params.key] - Specific object key. If omitted, a secure key is auto-generated
   * @param {string} [params.prefix='file'] - Prefix for auto-generated key
   * @param {string} [params.originalName=''] - Original filename for extension derivation
   * @param {string} [params.folder=''] - Optional folder prefix
   * @param {string} [params.contentType='application/octet-stream'] - MIME type
   * @param {object} [params.metadata={}] - Optional custom metadata
   * @returns {Promise<{ key: string, bucket: string, bucketType: string, url: string|null }>}
   */
  async upload({
    bucketType = "private",
    body,
    key,
    prefix = "file",
    originalName = "",
    folder = "",
    contentType = "application/octet-stream",
    metadata = {},
  } = {}) {
    if (body === undefined || body === null) {
      throw new Error("Upload payload (body) is required.");
    }

    const bucketName = this.resolveBucket(bucketType);
    const targetKey = key ? this.sanitizeObjectKey(key) : this.generateObjectKey(prefix, originalName, folder);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: targetKey,
      Body: body,
      ContentType: contentType,
      ...(metadata && Object.keys(metadata).length > 0 && { Metadata: metadata }),
    });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      // Avoid leaking credentials or internal details
      throw new Error(`S3 upload failed for key "${targetKey}": ${error.message || "Unknown error"}`);
    }

    const isPublic = bucketType === "public" || bucketName === this.publicBucket;
    const url = isPublic ? this.getCloudFrontUrl(targetKey) : null;

    return {
      key: targetKey,
      bucket: bucketName,
      bucketType: isPublic ? "public" : "private",
      url,
    };
  }

  /**
   * Delete an object from the specified S3 bucket.
   *
   * @param {string|object} keyOrOptions - Object key string OR { key, bucketType }
   * @param {'public'|'private'|string} [maybeBucketType='private'] - Target bucket if key is a string
   * @returns {Promise<{ success: boolean, key: string, bucket: string }>}
   */
  async delete(keyOrOptions, maybeBucketType = "private") {
    let key;
    let bucketType = maybeBucketType;

    if (typeof keyOrOptions === "string") {
      key = keyOrOptions;
    } else if (keyOrOptions && typeof keyOrOptions === "object") {
      key = keyOrOptions.key;
      bucketType = keyOrOptions.bucketType || maybeBucketType;
    } else {
      throw new Error("Object key is required for deletion.");
    }

    if (!key) {
      throw new Error("Object key is required for deletion.");
    }

    const cleanKey = this.sanitizeObjectKey(key);
    const bucketName = this.resolveBucket(bucketType);

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
    });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      throw new Error(`S3 deletion failed for key "${cleanKey}": ${error.message || "Unknown error"}`);
    }

    return {
      success: true,
      key: cleanKey,
      bucket: bucketName,
    };
  }

  /**
   * Generate a public CloudFront URL for a public asset.
   *
   * @param {string} key - S3 object key
   * @returns {string} Full HTTPS CloudFront URL
   */
  getCloudFrontUrl(key) {
    if (!key) throw new Error("Object key is required to generate CloudFront URL.");
    const cleanKey = this.sanitizeObjectKey(key);
    const cleanDomain = (this.cloudfrontDomain || "d2j3r11t01prca.cloudfront.net")
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    return `https://${cleanDomain}/${cleanKey}`;
  }

  /**
   * Generate a private presigned GET URL with exactly 900 seconds (15 minutes) expiry.
   * Must only be issued after resource-specific authorization has been verified.
   *
   * @param {string} key - S3 object key
   * @param {object} [options={}]
   * @param {'private'|'public'|string} [options.bucketType='private'] - Target bucket
   * @param {string} [options.responseContentDisposition] - Optional Content-Disposition override (e.g. attachment)
   * @returns {Promise<string>} Signed presigned GET URL
   */
  async getPresignedDownloadUrl(key, options = {}) {
    if (!key) throw new Error("Object key is required to generate presigned URL.");
    const cleanKey = this.sanitizeObjectKey(key);
    const bucketName = this.resolveBucket(options.bucketType || "private");
    const expiresIn = DEFAULT_PRESIGNED_EXPIRY_SECONDS; // Exactly 900 seconds

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
      ...(options.responseContentDisposition && {
        ResponseContentDisposition: options.responseContentDisposition,
      }),
    });

    try {
      return await this._getSignedUrlFn(this.s3Client, command, { expiresIn });
    } catch (error) {
      throw new Error(`Failed to generate presigned URL for key "${cleanKey}": ${error.message || "Unknown error"}`);
    }
  }

  /**
   * Identifies whether a given reference string is a legacy local file path.
   * (e.g. '/uploads/avatar-xxx.png' or 'uploads/record.pdf')
   *
   * @param {string} pathOrKey
   * @returns {boolean}
   */
  isLegacyLocalPath(pathOrKey) {
    if (!pathOrKey || typeof pathOrKey !== "string") return false;
    const normalized = pathOrKey.replace(/\\/g, "/");
    return normalized.startsWith("/uploads/") || normalized.startsWith("uploads/");
  }

  /**
   * Extracts an S3 object key from a full CloudFront URL or a legacy local path.
   *
   * @param {string} urlOrKey
   * @returns {string} Extracted object key or cleaned filename
   */
  extractObjectKey(urlOrKey) {
    if (!urlOrKey || typeof urlOrKey !== "string") return "";
    if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
      try {
        const parsed = new URL(urlOrKey);
        return parsed.pathname.replace(/^\/+/, "");
      } catch {
        return urlOrKey;
      }
    }
    if (this.isLegacyLocalPath(urlOrKey)) {
      return urlOrKey.replace(/^\/?uploads\//, "");
    }
    return urlOrKey.trim().replace(/^\/+/, "");
  }

  /**
   * Promotes an avatar (from a local file path or a private S3 object key) to the public S3 bucket
   * and returns the permanent CloudFront public URL.
   *
   * @param {string} avatarPathOrKey - Local file path (e.g. 'uploads/avatar-xxx.jpg') or S3 key
   * @returns {Promise<string>} The public CloudFront URL
   */
  async promoteAvatarToPublic(avatarPathOrKey) {
    if (!avatarPathOrKey || typeof avatarPathOrKey !== "string") {
      return "";
    }

    // 1. If already a CloudFront or full HTTPS URL, return as-is
    if (avatarPathOrKey.startsWith("http://") || avatarPathOrKey.startsWith("https://")) {
      return avatarPathOrKey;
    }

    const cleanFilename = this.extractObjectKey(avatarPathOrKey);
    if (!cleanFilename) return "";

    const uploadsDir = path.resolve("uploads");
    const localDiskPath = path.resolve(uploadsDir, cleanFilename);

    // 2. If it's a legacy local file on disk, read buffer and upload to public bucket
    if (fs.existsSync(localDiskPath)) {
      try {
        const fileBuffer = fs.readFileSync(localDiskPath);
        const ext = path.extname(cleanFilename).toLowerCase();
        let contentType = "image/jpeg";
        if (ext === ".png") contentType = "image/png";
        else if (ext === ".webp") contentType = "image/webp";

        const targetKey = cleanFilename.startsWith("avatars/")
          ? cleanFilename
          : `avatars/${cleanFilename}`;

        const uploadResult = await this.upload({
          bucketType: "public",
          body: fileBuffer,
          key: targetKey,
          contentType,
        });

        return uploadResult.url || this.getCloudFrontUrl(targetKey);
      } catch (err) {
        console.error("[S3StorageService] Failed to upload local avatar to public S3:", err.message);
        return this.getCloudFrontUrl(`avatars/${cleanFilename}`);
      }
    }

    // 3. If stored in private S3 bucket, copy to public bucket using CopyObjectCommand
    const sourceKey = cleanFilename.startsWith("avatars/")
      ? cleanFilename
      : `avatars/${cleanFilename}`;
    const destinationKey = sourceKey;

    try {
      const copyCommand = new CopyObjectCommand({
        CopySource: `${this.privateBucket}/${sourceKey}`,
        Bucket: this.publicBucket,
        Key: destinationKey,
      });
      await this.s3Client.send(copyCommand);

      // Clean up from private bucket safely
      try {
        await this.delete(sourceKey, "private");
      } catch (delErr) {
        // Non-fatal if delete from private bucket fails
      }

      return this.getCloudFrontUrl(destinationKey);
    } catch (copyErr) {
      // Fallback to CloudFront URL if copy fails
      return this.getCloudFrontUrl(destinationKey);
    }
  }
}

/**
 * Singleton instance configured with standard environment variables.
 */
export const s3StorageService = new S3StorageService();
