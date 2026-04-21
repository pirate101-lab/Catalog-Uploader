import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
    Object.setPrototypeOf(this, StorageNotConfiguredError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  isConfigured(): boolean {
    return !!process.env.PUBLIC_OBJECT_SEARCH_PATHS;
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new StorageNotConfiguredError(
        "PUBLIC_OBJECT_SEARCH_PATHS is not set. " +
          "Provision an Object Storage bucket and the env var will be set automatically."
      );
    }
    return paths;
  }

  /**
   * Find a file by searching PUBLIC_OBJECT_SEARCH_PATHS in order.
   * Returns null if not found in any search path.
   */
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  /**
   * Stream an object as a Response.
   */
  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  /**
   * Get a presigned PUT URL for uploading a file directly into the first
   * PUBLIC_OBJECT_SEARCH_PATHS entry, under a "catalog/" prefix.
   * The returned objectPath can be used immediately with GET /storage/public-objects/
   */
  async getUploadURL(name: string): Promise<{ uploadURL: string; objectPath: string }> {
    const publicPaths = this.getPublicObjectSearchPaths();
    const basePath = publicPaths[0];

    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectId = randomUUID();
    const relPath = `catalog/${objectId}-${safeName}`;
    const fullPath = `${basePath}/${relPath}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);
    const uploadURL = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });

    return { uploadURL, objectPath: relPath };
  }

  /**
   * Server-side upload for branding assets (logos). Writes the buffer
   * directly through the GCS client under a `branding/` prefix so the
   * caller controls the exact path/extension and the server can enforce
   * size/MIME limits before any bytes hit storage. Returns the public
   * URL the storefront/admin can immediately render.
   */
  async uploadBranding(
    buf: Buffer,
    contentType: string,
    extension: string,
  ): Promise<string> {
    const publicPaths = this.getPublicObjectSearchPaths();
    const basePath = publicPaths[0];
    const objectId = randomUUID();
    const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "img";
    const relPath = `branding/${objectId}.${safeExt}`;
    const fullPath = `${basePath}/${relPath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .save(buf, { contentType, resumable: false });
    return `/api/storage/public-objects/${relPath}`;
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
