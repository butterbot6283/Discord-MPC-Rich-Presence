const axios = require("axios");

// API Keys
const TMDB_API_TOKEN = "";
const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/original";

const fetchPoster = async (imdbID, malID, filePath) => {
  delete require.cache[require.resolve("./config")];
  const config = require("./config");

  // Deteksi TV/Movie
  const isTv = /(?:E|Ep|Episode|S\d+E\d+)/i.test(filePath);
  const title = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");

  try {
    // === 1. MAL ID ===
    if (malID) {
      console.log(`[Jikan] Coba MAL_ID: ${malID}`);
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${malID}`, { timeout: 8000 });
      const anime = res.data.data;
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, retry: false };
      }
    }

    // === 2. IMDb ID (TMDb) ===
    if (imdbID && TMDB_API_TOKEN) {
      console.log(`[TMDb] Coba IMDb: ${imdbID}`);
      const res = await axios.get(
        `https://api.themoviedb.org/3/find/${imdbID}?external_source=imdb_id`,
        { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }, timeout: 8000 }
      );
      const media = res.data.tv_results?.[0] || res.data.movie_results?.[0];
      if (media?.poster_path) {
        return {
          poster: `${tmdbBaseImageUrl}${media.poster_path}`,
          showTitle: media.name || media.title,
          retry: false
        };
      }
    }

    // === 3. Config MAL ===
    if (config.mal_id) {
      console.log(`[Jikan] Coba config.mal_id: ${config.mal_id}`);
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${config.mal_id}`, { timeout: 8000 });
      const anime = res.data.data;
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, retry: false };
      }
    }

    // === 4. Config IMDb ===
    if (config.imdb_id && TMDB_API_TOKEN) {
      console.log(`[TMDb] Coba config.imdb_id: ${config.imdb_id}`);
      const res = await axios.get(
        `https://api.themoviedb.org/3/find/${config.imdb_id}?external_source=imdb_id`,
        { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }, timeout: 8000 }
      );
      const media = res.data.tv_results?.[0] || res.data.movie_results?.[0];
      if (media?.poster_path) {
        return {
          poster: `${tmdbBaseImageUrl}${media.poster_path}`,
          showTitle: media.name || media.title,
          retry: false
        };
      }
    }

    // === 5. AutoPoster ===
    if (config.autoPoster && title) {
      const type = isTv ? "tv" : "movie";
      console.log(`[AutoPoster] Cari: "${title}"`);
      const res = await axios.get(
        `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(title)}&language=en-US&page=1`,
                                  { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }, timeout: 8000 }
      );
      const media = res.data.results?.[0];
      if (media?.poster_path) {
        return { poster: `${tmdbBaseImageUrl}${media.poster_path}`, showTitle: null, retry: false };
      }
    }

    // SEMUA GAGAL → minta coba lagi
    console.log("[API] Semua gagal → minta retry");
    return { poster: null, showTitle: null, retry: true };

  } catch (err) {
    console.log(`[API] ERROR: ${err.code || err.message}`);
    return { poster: null, showTitle: null, retry: true };
  }
};

module.exports = fetchPoster;
