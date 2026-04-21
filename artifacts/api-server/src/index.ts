import app from "./app";
import { logger } from "./lib/logger";
import { ObjectStorageService } from "./lib/objectStorage";
import { migrateAdminCredentials } from "./lib/adminCredentials";

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

  // One-time migration of legacy site_settings credentials into the
  // admin_users table. No-op once it has run, and never auto-creates an
  // admin row — first-run setup happens via the registration UI now.
  migrateAdminCredentials().catch((err) => {
    logger.error({ err }, "Failed to migrate admin credentials");
  });

  if (storageConfigured) {
    logger.info("Object storage: configured");
  } else {
    logger.warn(
      "Object storage: NOT configured — set PUBLIC_OBJECT_SEARCH_PATHS " +
        "(provision an Object Storage bucket to get this value)"
    );
  }
});
