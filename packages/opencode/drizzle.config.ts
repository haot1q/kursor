import os from "node:os"
import path from "node:path"
import { defineConfig } from "drizzle-kit"

// drizzle-kit runs this file outside the kursor app bootstrap, so we cannot
// import @opencode-ai/core/global directly. Reproduce the XDG data-dir lookup
// that Global.Path.data uses (the kursor namespace, see
// packages/core/src/global.ts) so migrations target the same SQLite file
// the running app uses. Operators can override with KURSOR_DB_URL.
const xdgDataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0
  ? process.env.XDG_DATA_HOME
  : path.join(os.homedir(), ".local", "share")

const defaultDbUrl = path.join(xdgDataHome, "kursor", "kursor.db")

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: process.env.KURSOR_DB_URL ?? defaultDbUrl,
  },
})
