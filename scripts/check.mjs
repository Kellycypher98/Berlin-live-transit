// Quick sanity check used locally and in CI: every server file must parse.
// (The client is type-checked and built separately with `npm run build`.)
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = ["server.js", "dev.mjs", ...readdirSync("lib").filter(f => f.endsWith(".js")).map(f => `lib/${f}`)];
let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); console.log(`ok   ${f}`); }
  catch (e) { failed++; console.error(`FAIL ${f}\n${e.stderr?.toString() ?? e.message}`); }
}
if (failed) { console.error(`${failed} file(s) failed`); process.exit(1); }
console.log(`All ${files.length} server files parse.`);
