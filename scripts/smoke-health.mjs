// Release smoke test helper: wait for a freshly launched Lilo to answer its local API.
//   node scripts/smoke-health.mjs --version 0.1.0 [--timeout 60]
// Polls http://127.0.0.1:17841/api/health until it answers, then checks app == "lilo" and that the
// version is the one being released. Exit 0 = ok, 1 = wrong answer, 2 = never answered.
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const expected = opt("version");
const timeoutS = Number(opt("timeout", "60"));
const url = "http://127.0.0.1:17841/api/health";

if (!expected) {
  console.error("usage: smoke-health.mjs --version <x.y.z> [--timeout <seconds>]");
  process.exit(1);
}

const deadline = Date.now() + timeoutS * 1000;
let lastError = "no attempt made";
while (Date.now() < deadline) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const body = await res.json();
      console.log(`health: ${JSON.stringify(body)}`);
      if (body.app !== "lilo") {
        console.error(`::error::/api/health says app=${JSON.stringify(body.app)}, expected "lilo"`);
        process.exit(1);
      }
      if (body.version !== expected) {
        console.error(`::error::/api/health says version ${body.version}, expected ${expected}`);
        process.exit(1);
      }
      console.log(`OK: lilo ${expected} is answering on 127.0.0.1:17841`);
      process.exit(0);
    }
    lastError = `HTTP ${res.status}`;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`::error::Lilo did not answer ${url} within ${timeoutS}s (last: ${lastError})`);
process.exit(2);
