// Minimal zero-dependency static file server for local preview/QA only.
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 8123;
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml", ".jpeg":"image/jpeg", ".jpg":"image/jpeg", ".png":"image/png" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store, no-cache, must-revalidate" });
    res.end(data);
  });
}).listen(PORT, () => console.log("preview server on http://localhost:" + PORT));
