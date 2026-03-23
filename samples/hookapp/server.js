const http = require("http");
const fs = require("fs");
const server = http.createServer((req, res) => {
  const migrated = fs.existsSync("/tmp/migrated");
  res.writeHead(200, {"Content-Type":"application/json"});
  res.end(JSON.stringify({ status: "ok", migrated }));
});
server.listen(7000, () => console.log("hookapp on :7000"));
