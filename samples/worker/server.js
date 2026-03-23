const express = require("express");
const fetch = require("node-fetch");
const app = express();

const API_URL = process.env.API_URL || "http://host.docker.internal:3000";

let lastStats = null;
let pollCount = 0;

async function pollStats() {
  try {
    const res = await fetch(`${API_URL}/api/stats`);
    lastStats = await res.json();
    pollCount++;
    console.log(`[poll #${pollCount}] Stats from API:`, lastStats);
  } catch (e) {
    console.error("Failed to reach API:", e.message);
    lastStats = { error: e.message };
  }
}

setInterval(pollStats, 30000);
pollStats();

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "worker", polls: pollCount, last_stats: lastStats });
});

app.get("/worker/status", (req, res) => {
  res.json({
    service: "worker",
    uptime: process.uptime(),
    polls: pollCount,
    last_stats: lastStats,
    api_url: API_URL,
  });
});

app.listen(4000, () => console.log("Worker listening on :4000"));
