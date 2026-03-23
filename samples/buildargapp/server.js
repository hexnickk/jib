const http = require("http");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("/app/config.json", "utf8"));
const server = http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type":"application/json"});
  res.end(JSON.stringify({ status: "ok", build_config: config }));
});
server.listen(9100, () => console.log("buildargapp on :9100"));
