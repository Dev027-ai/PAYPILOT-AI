const fs = require("node:fs");
const path = require("node:path");

const agent = process.env.npm_config_user_agent || "";
if (!agent.startsWith("pnpm/")) {
  console.error("Use pnpm to install this workspace: https://pnpm.io/installation");
  process.exit(1);
}
for (const name of ["package-lock.json", "yarn.lock"]) {
  try { fs.rmSync(path.join(process.cwd(), name), { force: true }); } catch {}
}
