import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  ObjectStorageService,
  StorageNotConfiguredError,
} from "../lib/objectStorage.ts";
import { requireAdmin } from "../middlewares/adminGuard.ts";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Admin-only: returns a presigned PUT URL plus the eventual public
 * objectPath. The client uploads file bytes directly to GCS via the
 * presigned URL, then stores the returned `publicUrl` as the persistent
 * reference. Guarded with requireAdmin so unauthenticated users cannot
 * mint signed URLs and write arbitrary public objects.
 */
router.post(
  "/storage/uploads/request-url",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const name =
        typeof req.body?.name === "string" && req.body.name.length > 0
          ? req.body.name
          : "upload.bin";
      const { uploadURL, objectPath } =
        await objectStorageService.getUploadURL(name);
      res.json({
        uploadURL,
        objectPath,
        publicUrl: `/api/storage/public-objects/${objectPath}`,
      });
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        res.status(503).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Failed to sign upload URL");
      res.status(500).json({ error: "Failed to sign upload URL" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * No authentication required — suitable for product catalog images.
 * Returns 404 if not found, 503 if storage is not configured.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      res.status(503).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

export default router;
