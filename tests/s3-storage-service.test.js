// tests/s3-storage-service.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

import {
  S3StorageService,
  DEFAULT_PRESIGNED_EXPIRY_SECONDS,
} from "../src/infrastructure/services/S3StorageService.js";

describe("S3StorageService Unit Tests (Mocked AWS SDK)", () => {
  const TEST_PUBLIC_BUCKET = "test-zydoc-public-assets";
  const TEST_PRIVATE_BUCKET = "test-zydoc-private-files";
  const TEST_CLOUDFRONT = "d2j3r11t01prca.cloudfront.net";

  function createMockStorageService(overrides = {}) {
    const sentCommands = [];
    let mockSendImpl = async (cmd) => {
      sentCommands.push(cmd);
      return { $metadata: { httpStatusCode: 200 } };
    };

    let presignedUrlCalls = [];
    let mockGetSignedUrlImpl = async (client, cmd, options) => {
      presignedUrlCalls.push({ client, cmd, options });
      return `https://${cmd.input.Bucket}.s3.ap-south-1.amazonaws.com/${cmd.input.Key}?X-Amz-Expires=${options.expiresIn}&X-Amz-Signature=mock`;
    };

    const mockClient = {
      send: async (cmd) => mockSendImpl(cmd),
    };

    const service = new S3StorageService({
      s3Client: mockClient,
      getSignedUrlFn: (client, cmd, opts) => mockGetSignedUrlImpl(client, cmd, opts),
      publicBucket: overrides.publicBucket || TEST_PUBLIC_BUCKET,
      privateBucket: overrides.privateBucket || TEST_PRIVATE_BUCKET,
      cloudfrontDomain: overrides.cloudfrontDomain || TEST_CLOUDFRONT,
      region: "ap-south-1",
      ...overrides,
    });

    return {
      service,
      sentCommands,
      presignedUrlCalls,
      setMockSend: (fn) => { mockSendImpl = fn; },
      setMockGetSignedUrl: (fn) => { mockGetSignedUrlImpl = fn; },
    };
  }

  describe("1. Configuration & Bucket Resolution", () => {
    it("resolves 'public' and 'private' to the configured bucket names", () => {
      const { service } = createMockStorageService();
      assert.equal(service.resolveBucket("public"), TEST_PUBLIC_BUCKET);
      assert.equal(service.resolveBucket("private"), TEST_PRIVATE_BUCKET);
      assert.equal(service.resolveBucket(TEST_PUBLIC_BUCKET), TEST_PUBLIC_BUCKET);
      assert.equal(service.resolveBucket(TEST_PRIVATE_BUCKET), TEST_PRIVATE_BUCKET);
    });

    it("rejects invalid or unknown bucket types", () => {
      const { service } = createMockStorageService();
      assert.throws(() => service.resolveBucket("unauthorized-bucket"), /Invalid bucket type or name/i);
      assert.throws(() => service.resolveBucket(""), /Invalid bucket type or name/i);
      assert.throws(() => service.resolveBucket(null), /Invalid bucket type or name/i);
    });

    it("verifies DEFAULT_PRESIGNED_EXPIRY_SECONDS is exactly 900 seconds", () => {
      assert.equal(DEFAULT_PRESIGNED_EXPIRY_SECONDS, 900);
    });

    it("isConfigured returns true when driver is s3 and both buckets are defined", () => {
      const { service } = createMockStorageService({ driver: "s3" });
      assert.equal(service.isConfigured(), true);
    });

    it("isConfigured returns false when driver is local, enabling disk fallback", () => {
      const { service } = createMockStorageService({ driver: "local" });
      assert.equal(service.isConfigured(), false);
    });

    it("isConfigured returns false when public or private bucket is missing", () => {
      const { service: noPub } = createMockStorageService({ publicBucket: "" });
      assert.equal(noPub.isConfigured(), false);
      const { service: noPriv } = createMockStorageService({ privateBucket: "" });
      assert.equal(noPriv.isConfigured(), false);
    });
  });

  describe("2. Object Key Generation & Sanitization", () => {
    it("generates unguessable UUID-based object keys preserving original extension", () => {
      const { service } = createMockStorageService();
      const key1 = service.generateObjectKey("avatar", "profile_pic.png");
      const key2 = service.generateObjectKey("avatar", "profile_pic.png");

      assert.notEqual(key1, key2);
      assert.match(key1, /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i);
    });

    it("supports optional folder prefixes", () => {
      const { service } = createMockStorageService();
      const keyWithFolder = service.generateObjectKey("rec", "blood_test.pdf", "medical-records");
      assert.match(keyWithFolder, /^medical-records\/rec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i);
    });

    it("sanitizes keys to prevent directory traversal and strips leading slashes", () => {
      const { service } = createMockStorageService();
      const sanitized = service.sanitizeObjectKey("/documents/report.pdf");
      assert.equal(sanitized, "documents/report.pdf");

      assert.throws(() => service.sanitizeObjectKey("../../../etc/passwd"), /path traversal/i);
      assert.throws(() => service.sanitizeObjectKey("folder/../secret.txt"), /path traversal/i);
      assert.throws(() => service.sanitizeObjectKey(""), /non-empty string/i);
      assert.throws(() => service.sanitizeObjectKey(null), /non-empty string/i);
      assert.throws(() => service.sanitizeObjectKey("bad\0file.pdf"), /path traversal or invalid characters/i);
    });
  });

  describe("3. CloudFront URL Generation", () => {
    it("generates a valid CloudFront HTTPS URL for public assets", () => {
      const { service } = createMockStorageService();
      const url = service.getCloudFrontUrl("avatars/doctor-approved-123.jpg");
      assert.equal(url, `https://${TEST_CLOUDFRONT}/avatars/doctor-approved-123.jpg`);
    });

    it("normalizes domains that include protocol prefixes or trailing slashes", () => {
      const { service } = createMockStorageService({ cloudfrontDomain: "https://d2j3r11t01prca.cloudfront.net/" });
      const url = service.getCloudFrontUrl("doctor-avatar.png");
      assert.equal(url, "https://d2j3r11t01prca.cloudfront.net/doctor-avatar.png");
    });

    it("throws when key is missing or invalid", () => {
      const { service } = createMockStorageService();
      assert.throws(() => service.getCloudFrontUrl(""), /Object key is required/i);
      assert.throws(() => service.getCloudFrontUrl(null), /Object key is required/i);
    });
  });

  describe("4. Upload Operations (upload)", () => {
    it("uploads to private bucket by default and sends PutObjectCommand", async () => {
      const { service, sentCommands } = createMockStorageService();
      const dummyBody = Buffer.from("test medical record content");

      const result = await service.upload({
        bucketType: "private",
        body: dummyBody,
        prefix: "rec",
        originalName: "mri_scan.pdf",
        contentType: "application/pdf",
        metadata: { patientId: "pat-123" },
      });

      assert.equal(sentCommands.length, 1);
      const cmd = sentCommands[0];
      assert.ok(cmd instanceof PutObjectCommand);
      assert.equal(cmd.input.Bucket, TEST_PRIVATE_BUCKET);
      assert.equal(cmd.input.ContentType, "application/pdf");
      assert.equal(cmd.input.Body, dummyBody);
      assert.deepEqual(cmd.input.Metadata, { patientId: "pat-123" });

      assert.equal(result.bucket, TEST_PRIVATE_BUCKET);
      assert.equal(result.bucketType, "private");
      assert.equal(result.url, null); // Private files do not return permanent public URLs
      assert.match(result.key, /^rec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i);
    });

    it("uploads to public bucket and returns CloudFront URL", async () => {
      const { service, sentCommands } = createMockStorageService();
      const imageBody = Buffer.from([0xff, 0xd8, 0xff]);

      const result = await service.upload({
        bucketType: "public",
        body: imageBody,
        key: "avatars/doctor-profile.jpg",
        contentType: "image/jpeg",
      });

      assert.equal(sentCommands.length, 1);
      const cmd = sentCommands[0];
      assert.equal(cmd.input.Bucket, TEST_PUBLIC_BUCKET);
      assert.equal(cmd.input.Key, "avatars/doctor-profile.jpg");
      assert.equal(cmd.input.ContentType, "image/jpeg");

      assert.equal(result.bucket, TEST_PUBLIC_BUCKET);
      assert.equal(result.bucketType, "public");
      assert.equal(result.url, `https://${TEST_CLOUDFRONT}/avatars/doctor-profile.jpg`);
    });

    it("rejects upload when payload body is missing", async () => {
      const { service } = createMockStorageService();
      await assert.rejects(
        async () => {
          await service.upload({ bucketType: "private", body: null });
        },
        /Upload payload \(body\) is required/i
      );
    });

    it("handles S3 client upload failures cleanly without leaking credentials", async () => {
      const { service, setMockSend } = createMockStorageService();
      setMockSend(async () => {
        const err = new Error("S3 Service Unavailable");
        err.name = "ServiceUnavailable";
        throw err;
      });

      await assert.rejects(
        async () => {
          await service.upload({
            bucketType: "private",
            body: Buffer.from("data"),
            key: "test.pdf",
          });
        },
        /S3 upload failed for key "test\.pdf": S3 Service Unavailable/i
      );
    });
  });

  describe("5. Presigned GET URL Generation (getPresignedDownloadUrl)", () => {
    it("generates presigned GET URL with exactly 900 seconds of expiry", async () => {
      const { service, presignedUrlCalls } = createMockStorageService();

      const presignedUrl = await service.getPresignedDownloadUrl("records/patient-report.pdf", {
        bucketType: "private",
      });

      assert.equal(presignedUrlCalls.length, 1);
      const call = presignedUrlCalls[0];
      assert.equal(call.options.expiresIn, 900, "Presigned URL must have exactly 900 seconds expiry");
      assert.ok(call.cmd instanceof GetObjectCommand);
      assert.equal(call.cmd.input.Bucket, TEST_PRIVATE_BUCKET);
      assert.equal(call.cmd.input.Key, "records/patient-report.pdf");

      assert.ok(presignedUrl.includes("X-Amz-Expires=900"));
    });

    it("supports ResponseContentDisposition override (e.g. attachment)", async () => {
      const { service, presignedUrlCalls } = createMockStorageService();

      await service.getPresignedDownloadUrl("records/report.pdf", {
        bucketType: "private",
        responseContentDisposition: 'attachment; filename="report.pdf"',
      });

      assert.equal(presignedUrlCalls.length, 1);
      assert.equal(
        presignedUrlCalls[0].cmd.input.ResponseContentDisposition,
        'attachment; filename="report.pdf"'
      );
    });

    it("throws when object key is missing or invalid", async () => {
      const { service } = createMockStorageService();
      await assert.rejects(
        async () => { await service.getPresignedDownloadUrl(""); },
        /Object key is required/i
      );
      await assert.rejects(
        async () => { await service.getPresignedDownloadUrl("../escape.pdf"); },
        /path traversal/i
      );
    });

    it("handles presigner generation errors cleanly", async () => {
      const { service, setMockGetSignedUrl } = createMockStorageService();
      setMockGetSignedUrl(async () => {
        throw new Error("Presigner failure");
      });

      await assert.rejects(
        async () => {
          await service.getPresignedDownloadUrl("valid-key.pdf");
        },
        /Failed to generate presigned URL for key "valid-key\.pdf": Presigner failure/i
      );
    });
  });

  describe("6. Delete Operations (delete)", () => {
    it("deletes object from private bucket using string key parameter", async () => {
      const { service, sentCommands } = createMockStorageService();

      const result = await service.delete("rec-12345.pdf");

      assert.equal(sentCommands.length, 1);
      const cmd = sentCommands[0];
      assert.ok(cmd instanceof DeleteObjectCommand);
      assert.equal(cmd.input.Bucket, TEST_PRIVATE_BUCKET);
      assert.equal(cmd.input.Key, "rec-12345.pdf");

      assert.deepEqual(result, {
        success: true,
        key: "rec-12345.pdf",
        bucket: TEST_PRIVATE_BUCKET,
      });
    });

    it("deletes object from public bucket using object options parameter", async () => {
      const { service, sentCommands } = createMockStorageService();

      const result = await service.delete({
        key: "avatars/old-avatar.png",
        bucketType: "public",
      });

      assert.equal(sentCommands.length, 1);
      const cmd = sentCommands[0];
      assert.equal(cmd.input.Bucket, TEST_PUBLIC_BUCKET);
      assert.equal(cmd.input.Key, "avatars/old-avatar.png");

      assert.deepEqual(result, {
        success: true,
        key: "avatars/old-avatar.png",
        bucket: TEST_PUBLIC_BUCKET,
      });
    });

    it("rejects deletion when key is missing or invalid", async () => {
      const { service } = createMockStorageService();
      await assert.rejects(
        async () => { await service.delete(""); },
        /Object key is required/i
      );
      await assert.rejects(
        async () => { await service.delete({ key: "" }); },
        /Object key is required/i
      );
      await assert.rejects(
        async () => { await service.delete("../../malicious.pdf"); },
        /path traversal/i
      );
    });

    it("handles S3 client deletion errors cleanly", async () => {
      const { service, setMockSend } = createMockStorageService();
      setMockSend(async () => {
        throw new Error("Access Denied to DeleteObject");
      });

      await assert.rejects(
        async () => {
          await service.delete("file-to-delete.pdf");
        },
        /S3 deletion failed for key "file-to-delete\.pdf": Access Denied/i
      );
    });
  });

  describe("7. Backward-Compatibility Detection Helpers", () => {
    it("correctly identifies legacy local /uploads/ paths", () => {
      const { service } = createMockStorageService();
      assert.equal(service.isLegacyLocalPath("/uploads/avatar-123.jpg"), true);
      assert.equal(service.isLegacyLocalPath("uploads/avatar-123.jpg"), true);
      assert.equal(service.isLegacyLocalPath("uploads\\avatar-123.jpg"), true);
      assert.equal(service.isLegacyLocalPath("avatar-123.jpg"), false);
      assert.equal(service.isLegacyLocalPath("https://d2j3r11t01prca.cloudfront.net/avatar-123.jpg"), false);
    });

    it("extracts clean object keys from CloudFront URLs, legacy paths, and bare keys", () => {
      const { service } = createMockStorageService();
      assert.equal(
        service.extractObjectKey("https://d2j3r11t01prca.cloudfront.net/avatars/doc.png"),
        "avatars/doc.png"
      );
      assert.equal(
        service.extractObjectKey("/uploads/rec-123.pdf"),
        "rec-123.pdf"
      );
      assert.equal(
        service.extractObjectKey("uploads/rec-123.pdf"),
        "rec-123.pdf"
      );
      assert.equal(
        service.extractObjectKey("rec-123.pdf"),
        "rec-123.pdf"
      );
      assert.equal(
        service.extractObjectKey(""),
        ""
      );
    });
  });

  describe("8. Doctor Avatar Promotion to Public S3 (promoteAvatarToPublic)", () => {
    it("returns existing CloudFront/HTTPS URL untouched", async () => {
      const { service } = createMockStorageService();
      const existingUrl = "https://d2j3r11t01prca.cloudfront.net/avatars/doc-avatar-1.jpg";
      const result = await service.promoteAvatarToPublic(existingUrl);
      assert.equal(result, existingUrl);
    });

    it("returns empty string if input is null, undefined, or empty", async () => {
      const { service } = createMockStorageService();
      assert.equal(await service.promoteAvatarToPublic(null), "");
      assert.equal(await service.promoteAvatarToPublic(undefined), "");
      assert.equal(await service.promoteAvatarToPublic(""), "");
    });

    it("promotes legacy local file on disk to public bucket and returns CloudFront URL", async () => {
      const { service, sentCommands } = createMockStorageService();
      const uploadsDir = path.resolve("uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const testFilename = "test-promote-avatar-disk.jpg";
      const testFilePath = path.resolve(uploadsDir, testFilename);
      fs.writeFileSync(testFilePath, Buffer.from("fake-jpg-content"));

      try {
        const publicUrl = await service.promoteAvatarToPublic(`/uploads/${testFilename}`);
        assert.ok(publicUrl.startsWith("https://d2j3r11t01prca.cloudfront.net/"));
        assert.ok(publicUrl.includes(testFilename));

        // Verify PutObjectCommand was sent targeting public bucket
        const putCmd = sentCommands.find((cmd) => cmd instanceof PutObjectCommand);
        assert.ok(putCmd, "PutObjectCommand was not sent!");
        assert.equal(putCmd.input.Bucket, TEST_PUBLIC_BUCKET);
      } finally {
        if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      }
    });

    it("promotes private S3 key to public bucket using CopyObjectCommand and deletes private source", async () => {
      const { service, sentCommands } = createMockStorageService();
      const privateKey = "avatars/private-doctor-avatar.png";

      const publicUrl = await service.promoteAvatarToPublic(privateKey);
      assert.equal(publicUrl, "https://d2j3r11t01prca.cloudfront.net/avatars/private-doctor-avatar.png");

      // Verify CopyObjectCommand was sent copying from private to public
      const copyCmd = sentCommands.find((cmd) => cmd instanceof CopyObjectCommand);
      assert.ok(copyCmd, "CopyObjectCommand was not sent!");
      assert.equal(copyCmd.input.Bucket, TEST_PUBLIC_BUCKET);
      assert.equal(copyCmd.input.CopySource, `${TEST_PRIVATE_BUCKET}/${privateKey}`);
      assert.equal(copyCmd.input.Key, privateKey);

      // Verify DeleteObjectCommand was sent to clean up private source
      const deleteCmd = sentCommands.find((cmd) => cmd instanceof DeleteObjectCommand);
      assert.ok(deleteCmd, "DeleteObjectCommand was not sent to clean up private bucket!");
      assert.equal(deleteCmd.input.Bucket, TEST_PRIVATE_BUCKET);
      assert.equal(deleteCmd.input.Key, privateKey);
    });
  });
});
