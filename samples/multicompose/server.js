const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type":"application/json"});
  res.end(JSON.stringify({
    status: "ok",
    env: process.env.NODE_ENV || "unset",
    log_level: process.env.LOG_LEVEL || "unset",
  }));
});
server.listen(9000, () => console.log("multicompose on :9000, NODE_ENV=" + process.env.NODE_ENV));
