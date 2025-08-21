const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// SQLite databáze
const db = new sqlite3.Database("database.sqlite");
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY, filename TEXT, name TEXT)");
  db.run(`
    CREATE TABLE IF NOT EXISTS votes (
      photo_id INTEGER,
      ip TEXT,
      vote INTEGER,
      timestamp INTEGER,
      UNIQUE(photo_id, ip)
    )
  `);
});

// Multer (upload)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Servování statických souborů
app.use(express.static(path.join(__dirname))); // index.html, adminek.html
app.use(express.static("uploads"));            // složka s nahranými fotkami

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API - fotky
app.get("/photos", (req, res) => {
  db.all(`
    SELECT p.id, p.filename, p.name,
           IFNULL(SUM(v.vote),0) as score
    FROM photos p
    LEFT JOIN votes v ON p.id = v.photo_id
    GROUP BY p.id
  `, (err, rows) => {
    if (err) return res.status(500).json({error: err});
    res.json(rows);
  });
});

// API - upload
app.post("/upload", upload.single("photo"), (req, res) => {
  const photoName = req.body.name || null;
  db.run("INSERT INTO photos (filename, name) VALUES (?, ?)", [req.file.filename, photoName], function(err) {
    if (err) return res.status(500).json({error: err});
    res.json({id: this.lastID, filename: req.file.filename, name: photoName});
  });
});

// Mazání fotky (admin)
app.post("/delete/:id", (req, res) => {
  const id = req.params.id;
  const username = req.body.username;
  const password = req.body.password;

  if (username !== "15963" || password !== "75321") {
    return res.status(403).json({ error: "Špatné přihlašovací údaje!" });
  }

  db.get("SELECT filename FROM photos WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Fotka nenalezena" });
    const filePath = path.join(__dirname, "uploads", row.filename);
    fs.unlink(filePath, () => {
      db.run("DELETE FROM photos WHERE id = ?", [id]);
      db.run("DELETE FROM votes WHERE photo_id = ?", [id]);
      res.json({ success: true });
    });
  });
});

// ADMIN - uprava skóre
app.post("/admin/updateScore/:id", (req, res) => {
  const id = req.params.id;
  const { username, password, score } = req.body;

  if (username !== "15963" || password !== "75321") {
    return res.status(403).json({ error: "Špatné přihlašovací údaje!" });
  }

  const newScore = parseInt(score);
  if (isNaN(newScore)) return res.status(400).json({ error: "Neplatné skóre" });

  db.run("DELETE FROM votes WHERE photo_id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: err });
    if (newScore !== 0) {
      db.run("INSERT INTO votes (photo_id, ip, vote, timestamp) VALUES (?, ?, ?, ?)", 
        [id, "admin", newScore, Math.floor(Date.now()/1000)], 
        function(err2) {
          if (err2) return res.status(500).json({ error: err2 });
          res.json({ success: true });
        });
    } else {
      res.json({ success: true });
    }
  });
});

// API - hlasování (omezení 24h)
app.post("/vote/:id", (req, res) => {
  const photoId = req.params.id;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const vote = req.body.vote;
  const now = Math.floor(Date.now() / 1000);

  db.get("SELECT timestamp FROM votes WHERE photo_id = ? AND ip = ?", [photoId, ip], (err, row) => {
    if (err) return res.status(500).json({ error: err });

    if (row) {
      const elapsed = now - row.timestamp;
      if (elapsed < 24 * 60 * 60) {
        return res.status(429).json({ error: "Můžeš hlasovat znovu až za 24 hodin." });
      }
      db.run("UPDATE votes SET vote = ?, timestamp = ? WHERE photo_id = ? AND ip = ?",
        [vote, now, photoId, ip],
        function(err2) {
          if (err2) return res.status(500).json({ error: err2 });
          res.json({ success: true });
        });
    } else {
      db.run("INSERT INTO votes (photo_id, ip, vote, timestamp) VALUES (?, ?, ?, ?)",
        [photoId, ip, vote, now],
        function(err2) {
          if (err2) return res.status(500).json({ error: err2 });
          res.json({ success: true });
        });
    }
  });
});

app.listen(PORT, () => console.log(`✅ Server běží na http://localhost:${PORT}`));
