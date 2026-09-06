import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { guitar, category } from "ultimate-guitar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const ug = guitar();
const PORT = Number(process.env.PORT) || 4173;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function parseSearchQuery(q) {
  const raw = String(q || "").trim();
  if (!raw) return { title: "", artist: "" };

  const dash = raw.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    return { title: dash[0].trim(), artist: dash.slice(1).join(" - ").trim() };
  }

  const by = raw.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) return { title: by[1].trim(), artist: by[2].trim() };

  return { title: raw, artist: "" };
}

app.get("/api/songs/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({ error: "Missing q" });
    }

    const { title, artist } = parseSearchQuery(q);
    const result = artist
      ? await ug.search(title, artist, category.CHORDS)
      : await ug.search(title, category.CHORDS);

    if (result.status !== 200) {
      return res.status(result.status || 502).json({
        error: "Search failed",
        details: result,
      });
    }

    const rawList = Array.isArray(result.responses) ? result.responses : [];
    const results = rawList
      .filter((r) => String(r.type || "").toLowerCase().includes("chord"))
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        title: r.song_name || r.localized_song_name || title,
        artist: r.artist_name || r.localized_artist_name || artist || "",
        url: r.tab_url,
        rating: r.rating ?? null,
        votes: r.votes ?? null,
        key: r.tonality_name || r.recording?.tonality_name || "",
        difficulty: r.difficulty || "",
        version: r.version ?? null,
      }));

    res.json({ results });
  } catch (err) {
    console.error("search error", err);
    res.status(500).json({
      error: "Search failed",
      message: err?.message || String(err),
    });
  }
});

app.get("/api/songs/fetch", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) {
      return res.status(400).json({ error: "Missing url" });
    }

    if (!/^https:\/\/tabs\.ultimate-guitar\.com\//i.test(url)) {
      return res.status(400).json({ error: "Only Ultimate Guitar tab URLs are allowed" });
    }

    const fetched = await ug.fetch(url);
    if (fetched.status !== 200) {
      return res.status(fetched.status || 502).json({
        error: "Fetch failed",
        details: fetched,
      });
    }

    const content =
      typeof fetched.response === "string"
        ? fetched.response
        : fetched.response?.content ||
          fetched.response?.contentText ||
          JSON.stringify(fetched.response);

    res.json({
      title: fetched.response?.song_name || "",
      artist: fetched.response?.artist_name || "",
      key: fetched.response?.tonality_name || "",
      url,
      content: String(content || "").replace(/\r\n/g, "\n"),
    });
  } catch (err) {
    console.error("fetch error", err);
    res.status(500).json({
      error: "Fetch failed",
      message: err?.message || String(err),
    });
  }
});

app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gesture Synth listening on http://0.0.0.0:${PORT}`);
});
