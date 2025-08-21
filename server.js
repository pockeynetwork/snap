const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// DB a uploads na persistentním disku Renderu
const DATA_DIR = "/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const db = new sqlite3.Database(path.join(DATA_DIR, "database.sqlite"));
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY, filename TEXT, name TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS votes (photo_id INTEGER, ip TEXT, vote INTEGER, UNIQUE(photo_id, ip))");
});

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static("views"));
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

  // Smažeme všechny hlasy a nastavíme nové skóre přímo
  db.run("DELETE FROM votes WHERE photo_id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: err });
    if (newScore !== 0) {
      // Vložíme jeden virtuální hlas pro dosažení požadovaného skóre
      db.run("INSERT INTO votes (photo_id, ip, vote) VALUES (?, ?, ?)", [id, "admin", newScore], function(err2) {
        if (err2) return res.status(500).json({ error: err2 });
        res.json({ success: true });
      });
    } else {
      res.json({ success: true });
    }
  });
});

// API - hlasování
app.post("/vote/:id", (req, res) => {
  const photoId = req.params.id;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const vote = req.body.vote; // 1 nebo -1

  db.run("INSERT OR REPLACE INTO votes (photo_id, ip, vote) VALUES (?, ?, ?)", 
    [photoId, ip, vote], 
    function(err) {
      if (err) return res.status(500).json({error: err});
      res.json({success: true});
    }
  );
});

app.listen(PORT, () => console.log(`✅ Server běží na portu ${PORT}`));

