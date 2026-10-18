Zydoc Backend — S3 Implementation Plan
Purpose
Implement AWS S3 storage in the existing Zydoc backend in small, reviewable phases. This document is the backend plan and source of truth for backend implementation chats.
Confirmed setup
- AWS region: ap-south-1
- Public-assets bucket: zydoc-prod-public-assets-482731
- Private-files bucket: zydoc-prod-private-files-482731
- CloudFront domain: d2j3r11t01prca.cloudfront.net
- Backend AWS SDK packages have already been installed:
  - @aws-sdk/client-s3
  - @aws-sdk/s3-request-presigner
- Required AWS/S3 variables are already present and confirmed in the backend .env. Do not ask the user to paste, print, or re-check secret values.
- Use the existing environment variable names already configured in .env; do not rename them or invent alternatives. The expected configuration includes AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_PUBLIC_BUCKET, S3_PRIVATE_BUCKET, AWS_CLOUDFRONT_DOMAIN, and FILE_STORAGE_DRIVER.
- .env must remain untracked and secret values must never be copied into source files, tests, reports, prompts, or logs.
Non-negotiable constraints
1. Inspect the real repository and existing code before each phase. Do not rely on assumptions or another chat's history.
2. Preserve current API routes, request shapes, response shapes, validation rules, authorization semantics, appointment logic, and business logic unless a specific security fix is required and documented.
3. Do not perform a broad refactor, UI change, API rename, unrelated cleanup, or add unnecessary abstractions.
4. Keep existing file signature/content validation. S3 integration must not bypass MIME, extension, size, magic-byte, or ownership checks.
5. Never make either S3 bucket public. Public assets are served through CloudFront with the configured Origin Access Control. Private objects are only accessed after backend authorization.
6. Private presigned GET URLs must expire after 900 seconds (15 minutes). Generate them only after checking the requesting user's authorization for that specific resource.
7. Treat presigned URLs as bearer links: do not log them or persist them as permanent public URLs.
8. Use generated, non-user-controlled S3 object keys. Do not use an uploaded filename directly as the object key.
9. Avoid orphaned S3 objects. For replacement/deletion, coordinate storage operations and database updates carefully; document unavoidable failure modes.
10. Do not delete or migrate user data, existing database records, or S3 objects as part of implementation without explicit approval.
11. Do not modify .env values. Update .env.example only if required, with variable names and safe placeholders only.
12. Do not commit credentials, local test artifacts, or real patient/doctor files.
File access policy to preserve
Implement and verify the actual policy in the repository; do not grant access just because a URL is known.
- Public: only approved doctors' profile images/avatars intended for public display. Do not expose pending/unapproved doctor images or any verification documents through CloudFront.
- Doctor verification documents: only the submitting doctor and authorized administrators.
- Patient medical records: patient owner and the specific treating/attending doctor allowed by existing appointment rules. Do not broaden admin access unless existing policy explicitly allows it.
- Patient avatar: preserve the current intended owner/authorized-role policy after reviewing actual code.
- Consultation attachments: only the appointment's authorized patient/doctor and authorized administrators according to existing policy.
- Dispute proof: implement explicit authorization for the submitter and authorized administrator as appropriate to the existing dispute/refund model. Audit and fix the known gap where dispute/refund proof URLs may not be recognized by the secure file controller.
- Check all other current file URL usages and ensure no private file is returned as a permanent public URL.
Existing flows identified by the initial audit — verify against current source
- Patient avatar: PUT /api/patient/profile-update, PUT /api/patient/profile; PatientController.updateProfile; UpdatePatientProfile.execute; Patient.avatarUrl.
- Patient medical records: POST /api/patient/records; MedicalRecordController.addRecord; AddMedicalRecord.execute; MedicalRecord.fileUrl.
- Doctor onboarding/profile: POST /api/doctor/profile-update; DoctorController.updateProfile; UpdateDoctorProfile.execute; avatar, medical certificate, government ID, and qualification certificates.
- Doctor qualification update: PUT /api/doctor/profile/qualifications; DoctorController.updateQualifications; PatchDoctorProfile.execute.
- Doctor certificate upload: POST /api/doctor/profile/certificates; DoctorController.uploadCertificates; confirm whether files are referenced or intentionally temporary.
- Consultation attachments: POST /api/appointments/:id/consultation-files; AppointmentController.uploadConsultationFile; appointment and consultation-record references.
- Dispute proof: POST /api/appointments/:id/dispute; AppointmentController.disputeAppointment; audit existing validation and frontend contract. Current audit found local /uploads/... validation and a potential mismatch with external-link UI.
- Secure file delivery: server.js route /uploads/:filename; SecureFileController.
- Upload middleware and validation: src/presentation/middleware/uploadMiddleware.js, src/infrastructure/utils/fileValidator.js.
- Delete medical record: src/application/usecases/patient/DeleteMedicalRecord.js.
The file list above is a starting point, not permission to change all files at once. Reconfirm names and behavior from the repository before editing.
Required storage behavior
- Public assets: upload to S3_PUBLIC_BUCKET; return/use the configured CloudFront URL for eligible public assets only.
- Private files: upload to S3_PRIVATE_BUCKET; store a stable object key or storage identifier in the database, not a presigned URL. At the authorized file-access endpoint, issue a 15-minute presigned GET URL or securely stream the file. Prefer the least disruptive option consistent with existing API contracts.
- Deletes: use DeleteObject for the matching bucket/key, but ensure authorization and database/storage consistency. Never accept an arbitrary client-supplied key for deletion.
- Uploads: retain size/type/signature validation. If moving from disk storage to memory/buffer storage, verify every middleware and validator path works with buffers and avoid unbounded memory use.
- Local/test support: tests must mock S3 operations or use an isolated test configuration. Never run tests that delete real user objects.
- Errors: do not leak AWS credentials, internal object keys where inappropriate, presigned URLs, or stack traces to clients.
Phase-by-phase execution
Phase B0 — Repository inspection and plan validation (no application code changes)
1. Read this document and inspect the backend repository.
2. Confirm package dependencies, environment variable names (names only; never print values), upload middleware, validators, current file URL schema, secure-file authorization, upload/delete flows, tests, and Docker behavior.
3. Identify differences from this plan and list exact files likely to change.
4. Do not modify application code, .env, database data, or S3 objects.
5. Report findings and proposed sequence. Stop and wait for approval.
Phase B1 — Storage foundation only
1. Implement the smallest maintainable S3 storage module needed by current code.
2. Add upload, delete, CloudFront public URL, and private presigned GET URL functionality.
3. Configure 900-second expiry for private GET URLs.
4. Use existing confirmed environment variable names.
5. Keep changes limited to storage foundation and directly necessary tests. Do not migrate upload controllers/use cases in this phase.
6. Add unit tests with mocked AWS SDK commands for object key handling, bucket selection, URL generation, 900-second expiry, deletion, and error handling.
7. Run relevant tests and report exact changed files/results. Stop for review.
Phase B2 — Upload middleware and validation integration
1. Adapt upload middleware/storage handling for S3 without weakening validation.
2. Preserve generated filenames/object keys, file size limits, MIME/extension checks, and magic-byte/content checks.
3. Ensure invalid uploads are rejected and temporary resources are cleaned safely.
4. Add/update focused tests. Do not yet migrate every business flow unless the approved scope explicitly includes it.
5. Stop for review.
Phase B3 — Public doctor images
1. Migrate only approved public doctor profile images to the public bucket.
2. Serve them through the configured CloudFront domain.
3. Ensure pending/unapproved doctor images and all verification documents remain private.
4. Update database URL/key representation only as needed, with backward compatibility for existing records.
5. Test upload, replacement, approval state, and public access boundaries. Stop for review.
Phase B4 — Private doctor documents and patient avatars
1. Migrate the relevant doctor verification/profile document and patient-avatar flows in a small, explicitly scoped batch.
2. Enforce the documented owner/admin checks before generating private links.
3. Store stable object keys, not presigned URLs.
4. Preserve API request/response contracts or document a necessary, approved compatibility adjustment.
5. Test authorized and unauthorized roles. Stop for review.
Phase B5 — Patient medical records and consultation attachments
1. Migrate patient medical-record uploads and deletion.
2. Migrate consultation attachment uploads and file access.
3. Check the appointment/doctor/patient relationship using existing business rules before access.
4. Ensure database deletion/replacement and S3 deletion cannot be abused by arbitrary identifiers.
5. Add tests for authorization, missing objects, failure handling, and cleanup. Stop for review.
Phase B6 — Dispute proof and remaining file flows
1. Trace the actual dispute/refund proof data model, controller validation, frontend request contract, and file authorization.
2. Align storage handling with the existing intended product flow. Do not invent a new API contract without approval.
3. Explicitly test submitter access and authorized admin access, and deny unrelated users.
4. Review every remaining /uploads/ usage and distinguish public images from private files.
5. Stop for review.
Phase B7 — Cleanup, compatibility, and final backend verification
1. Review legacy /uploads/ route behavior and backward compatibility. Do not remove old-file support until existing stored references are accounted for.
2. Review replacement/deletion cleanup and orphan risks.
3. Update .env.example with safe placeholders if necessary; do not edit .env values.
4. Run backend tests, security tests, and any existing type/lint checks. Report exact commands and results.
5. Review Dockerfile and runtime permissions only if needed for the chosen storage implementation.
6. Do not deploy or alter AWS infrastructure as part of this phase.
Required report after every phase
- Phase completed and scope.
- Files changed and why.
- API/data-contract impact (explicitly say “none” if none).
- Security/authorization checks added or preserved.
- Tests/commands run and exact results.
- Known limitations or unresolved issues.
- Confirmation that .env secrets and real user data were not exposed or altered.
- Stop and wait for approval before the next phase.
Definition of done
- Public approved doctor images use CloudFront and do not expose private documents.
- Private files are stored in the private bucket and only served after resource-specific authorization.
- Private presigned URLs expire after 15 minutes.
- Existing API contracts and business logic remain compatible unless a change was explicitly approved.
- Upload validation, deletion authorization, and failure cleanup are tested.
- No AWS credentials or private URLs appear in logs, source control, or client-visible errors.
- All relevant tests pass, with remaining failures clearly reported.