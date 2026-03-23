const express = require("express");
const { Pool } = require("pg");
const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || "db",
  port: 5432,
  user: process.env.DB_USER || "jib",
  password: process.env.DB_PASS || "jibpass",
  database: process.env.DB_NAME || "jibdb",
});

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log("DB initialized");
  } catch (e) { console.error("DB init error:", e.message); }
})();

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "api" });
  } catch (e) { res.status(500).json({ status: "error", error: e.message }); }
});

app.get("/api/notes", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM notes ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/notes", async (req, res) => {
  const { content } = req.body;
  const { rows } = await pool.query("INSERT INTO notes (content) VALUES ($1) RETURNING *", [content]);
  res.status(201).json(rows[0]);
});

app.get("/api/stats", async (req, res) => {
  const { rows } = await pool.query("SELECT COUNT(*) as count FROM notes");
  res.json({ note_count: parseInt(rows[0].count), timestamp: new Date().toISOString() });
});

app.listen(3000, () => console.log("API listening on :3000"));
