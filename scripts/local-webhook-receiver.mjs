// Local stand-in for the cockpit's completion-webhook receiver, used to PROVE
// section E end-to-end without needing the real cockpit running. Verifies the
// HMAC exactly as the cockpit will, and appends each received payload to
// webhook-received.log so the test can assert delivery + idempotency.
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";

const PORT = Number(process.env.RECEIVER_PORT || 4545);
const SECRET = process.env.DOCUSIGN_API_SECRET || "";
const LOG = process.env.RECEIVER_LOG || "webhook-received.log";

function verify(ts, sig, raw) {
  if (!SECRET) return true; // local mode without secret
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const ts = req.headers["x-docusign-timestamp"];
      const sig = req.headers["x-docusign-signature"];
      const key = req.headers["x-idempotency-key"];
      const ok = verify(ts, sig, raw);
      appendFileSync(
        LOG,
        JSON.stringify({ at: new Date().toISOString(), ok, idempotencyKey: key, body: raw }) + "\n",
      );
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: ok }));
    });
  })
  .listen(PORT, () => console.log(`local webhook receiver on :${PORT} (secret=${SECRET ? "set" : "none"})`));
