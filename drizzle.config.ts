import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

const parsedUrl = new URL(connectionString);
const sslOverride = parsedUrl.searchParams.get("ssl");
if (sslOverride && /^(false|0|off|disable|disabled)$/i.test(sslOverride)) {
  throw new Error("DATABASE_URL disables TLS; TiDB Cloud requires encrypted transport.");
}

const isTiDBServerlessHost = /tidbcloud\.com|gateway\d*\.|mysql\.|db\./i.test(parsedUrl.hostname);
if ((isTiDBServerlessHost || parsedUrl.hostname.includes("localhost") === false) && !parsedUrl.searchParams.has("ssl")) {
  parsedUrl.searchParams.set("ssl", JSON.stringify({ minVersion: "TLSv1.2", rejectUnauthorized: true }));
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: parsedUrl.toString(),
  },
});
