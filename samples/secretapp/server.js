const http = require("http");
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({
      status: "ok",
      secret_loaded: !!process.env.MY_SECRET,
      db_url_set: !!process.env.DATABASE_URL,
    }));
  } else {
    res.writeHead(200);
    res.end("secretapp");
  }
});
server.listen(6000, () => console.log("secretapp on :6000"));
