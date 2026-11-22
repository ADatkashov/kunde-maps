// Validate MapLibre style JSON files against the official style specification.
// Usage: node scripts/validate-style.mjs apps/web/style.json apps/web/style-dark.json   (needs @maplibre/maplibre-gl-style-spec)
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import fs from "node:fs";

let failures = 0;
for (const file of process.argv.slice(2)) {
  const errors = validateStyleMin(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(`${file}: ${errors.length ? errors.length + " error(s)" : "valid"}`);
  for (const error of errors.slice(0, 20)) console.log("  -", error.message);
  failures += errors.length;
}
process.exit(failures ? 1 : 0);
