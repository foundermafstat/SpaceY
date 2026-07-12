import { randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const target = resolve(process.argv[2] ?? ".spacey/local-compose.env");
await mkdir(dirname(target), { recursive: true, mode: 0o700 });

try {
  const file = await open(target, "wx", 0o600);
  await file.writeFile([
    `LOCAL_POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    "LOCAL_MINIO_ROOT_USER=spaceydev",
    `LOCAL_MINIO_ROOT_PASSWORD=${randomBytes(24).toString("hex")}`,
    "LOCAL_S3_BUCKET=spacey-local-replays",
    "",
  ].join("\n"));
  await file.close();
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
}
