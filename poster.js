const axios = require("axios");

// === API Keys ===
const OMDB_API_KEY = ""; // Ganti kalau mau

// === Fix OMDb Poster URL ===
const fixOmdbPosterUrl = (url) => {
  if (url && url.includes("._V1_SX300")) {
    return url.replace(/\._V1_SX300/, "");
  }
  return url;
};

// === MAIN FUNCTION ===
const fetchPoster = async (imdbID, malID, filePath) => {
  delete require.cache[require.resolve("./config")];
  const config = require("./config");

  try {
    // === 1. MAL ID (Jikan) ===
    if (malID) {
      console.log(`[Jikan] Coba MAL_ID: ${malID}`);
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${malID}`, { timeout: 8000 });
      const anime = res.data.data;
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, retry: false };
      }
    }

    // === 2. IMDb ID (OMDb) ===
    if (imdbID && OMDB_API_KEY) {
      console.log(`[OMDb] Coba IMDb: ${imdbID}`);
      const res = await axios.get(
        `https://www.omdbapi.com/?i=${imdbID}&apikey=${OMDB_API_KEY}`,
        { timeout: 8000 }
      );
      const data = res.data;
      if (data?.Poster && data.Poster !== "N/A") {
        return {
          poster: fixOmdbPosterUrl(data.Poster),
          showTitle: data.Title,
          retry: false
        };
      }
    }

    // === 3. Config MAL ID ===
    if (config.mal_id) {
      console.log(`[Jikan] Coba config.mal_id: ${config.mal_id}`);
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${config.mal_id}`, { timeout: 8000 });
      const anime = res.data.data;
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, retry: false };
      }
    }

    // === 4. Config IMDb ID ===
    if (config.imdb_id && OMDB_API_KEY) {
      console.log(`[OMDb] Coba config.imdb_id: ${config.imdb_id}`);
      const res = await axios.get(
        `https://www.omdbapi.com/?i=${config.imdb_id}&apikey=${OMDB_API_KEY}`,
        { timeout: 8000 }
      );
      const data = res.data;
      if (data?.Poster && data.Poster !== "N/A") {
        return {
          poster: fixOmdbPosterUrl(data.Poster),
          showTitle: data.Title,
          retry: false
        };
      }
    }

    // === 5. AutoPoster (Jikan Search) ===
    if (config.autoPoster && filePath) {
      const title = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "").replace(/\[.*?\]|\s*S\d+E\d+.*/gi, "").trim();
      if (title) {
        console.log(`[AutoPoster] Cari: "${title}"`);
        const res = await axios.get(
          `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`,
                                    { timeout: 8000 }
        );
        const anime = res.data.data[0];
        if (anime?.images?.jpg?.large_image_url) {
          return { poster: anime.images.jpg.large_image_url, showTitle: null, retry: false };
        }
      }
    }

    // SEMUA GAGAL → minta retry
    console.log("[API] Semua gagal → minta retry");
    return { poster: null, showTitle: null, retry: true };

  } catch (err) {
    console.log(`[API] ERROR: ${err.code || err.message}`);
    return { poster: null, showTitle: null, retry: true };
  }
};

module.exports = fetchPoster;
