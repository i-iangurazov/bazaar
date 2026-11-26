// A staged model service can start before its production database is connected.
// Enabling indexing is an explicit, separate release step after migrations.
if (process.env.PRODUCT_PHOTO_WORKER_ENABLED === "1") {
  await import("./product-photo-worker.ts");
} else {
  process.stdout.write("Photo indexing is disabled for this service stage.\n");
}
