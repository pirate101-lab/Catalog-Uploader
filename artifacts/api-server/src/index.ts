import app from "./app";
import { logger } from "./lib/logger";
import { ObjectStorageService } from "./lib/objectStorage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const storageConfigured = new ObjectStorageService().isConfigured();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  if (storageConfigured) {
    logger.info("Object storage: configured");
  } else {
    logger.warn(
      "Object storage: NOT configured — set PUBLIC_OBJECT_SEARCH_PATHS and " +
        "PRIVATE_OBJECT_DIR (provision an Object Storage bucket to get these values)"
    );
  }
});
