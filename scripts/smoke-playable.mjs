const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const checks = [
  { path: "/hangar", marker: "Test Battle" },
  { path: "/battle", marker: "Survival Test" }
];

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${check.path} returned ${response.status}`);
  }
  const html = await response.text();
  if (!html.includes(check.marker)) {
    throw new Error(`${check.path} missing marker: ${check.marker}`);
  }
  console.log(`${check.path} OK`);
}

console.log("Playable smoke OK");
