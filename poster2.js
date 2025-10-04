const axios = require("axios");
const { filenameParse } = require("@ctrl/video-filename-parser");

// === API Keys ===
const TMDB_API_TOKEN = ""; // isi manual
const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/original";

// === Fallback Cleaner ===
const cleanTitleForSearch = (title) => {
  return title
    .replace(/\[.*?\]/g, "")
    .replace(/\b(S\d{1,2}E\d{1,2}|E\d{1,2}|Episode \d{1,2})\b/gi, "")
    .replace(
      /\b(720p|1080p|480p|BluRay|BRRip|Webrip|WEB-DL|WEBDL|HDRip|x264|x265|HEVC|HDTV|DVDRip|AAC)\b/gi,
      ""
    )
    .replace(/[\._\-]/g, " ")
    .trim();
};

// === Regex Episode Detector ===
const episodeRegex = /(?:E|Ep|Episode| - | S?\d+ - )(\d{1,2})(?=\.|$)/i;

const fetchPoster = async (imdbID, malID, filePath, isUsingTxtId = false) => {
  delete require.cache[require.resolve("./config")];
  const config = require("./config");

  // === Deteksi TV/Movie lebih dulu ===
  const isTv = episodeRegex.test(filePath);
  console.log(`[detect] File detected as: ${isTv ? "TV Series" : "Movie"}`);

  // Parse filename sesuai hasil deteksi
  const parsed = isTv ? filenameParse(filePath, true) : filenameParse(filePath);
  let title = parsed?.title || "";
  if (title) {
    console.log(`[parser] Parsed title: "${title}" from "${filePath}"`);
  } else {
    title = cleanTitleForSearch(filePath);
    console.log(`[fallback] Cleaned title: "${title}" from "${filePath}"`);
  }

  try {
    // === Prioritas 1: MAL ID (metadata) ===
    if (malID) {
      console.log(`[api] Fetching from Jikan using MAL_ID: ${malID}`);
      const jikanUrl = `https://api.jikan.moe/v4/anime/${malID}`;
      const response = await axios.get(jikanUrl);
      const anime = response.data.data;
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, usedConfigId: isUsingTxtId ? true : false };
      }
    }

    // === Prioritas 2: IMDb ID (TMDb) ===
    if (imdbID && TMDB_API_TOKEN) {
      console.log(`[api] Fetching from TMDb using IMDb_ID: ${imdbID}`);
      const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbID}?external_source=imdb_id`;
      const response = await axios.get(tmdbUrl, {
        headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }
      });
      const media = response.data.tv_results[0] || response.data.movie_results[0];
      if (media?.poster_path) {
        return { poster: `${tmdbBaseImageUrl}${media.poster_path}`, showTitle: media.name || media.title, usedConfigId: isUsingTxtId ? true : false };
      }
    }

    // === Prioritas 3: Config MAL ID ===
    if (config.mal_id) {
      console.log(`[api] Fetching from Jikan using config.mal_id: ${config.mal_id}`);
      const jikanUrl = `https://api.jikan.moe/v4/anime/${config.mal_id}`;
      const response = await axios.get(jikanUrl);
      const anime = response.data.data;
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, usedConfigId: true };
      }
    }

    // === Prioritas 4: Config IMDb ID (TMDb) ===
    if (config.imdb_id && TMDB_API_TOKEN) {
      console.log(`[api] Fetching from TMDb using config.imdb_id: ${config.imdb_id}`);
      const tmdbUrl = `https://api.themoviedb.org/3/find/${config.imdb_id}?external_source=imdb_id`;
      const response = await axios.get(tmdbUrl, {
        headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }
      });
      const media = response.data.tv_results[0] || response.data.movie_results[0];
      if (media?.poster_path) {
        return { poster: `${tmdbBaseImageUrl}${media.poster_path}`, showTitle: media.name || media.title, usedConfigId: true };
      }
    }

    // === Prioritas 5: AutoPoster pakai title (TMDb Search) ===
    if (config.autoPoster && title && TMDB_API_TOKEN) {
      const searchType = isTv ? "tv" : "movie";
      console.log(`[api] Searching TMDb as ${searchType}: "${title}"`);

      const tmdbUrl = `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(
        title
      )}&include_adult=false&language=en-US&page=1`;

      const response = await axios.get(tmdbUrl, {
        headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` },
      });
      const media = response.data.results[0];
      if (media?.poster_path) {
        return {
          poster: `${tmdbBaseImageUrl}${media.poster_path}`,
          showTitle: media.name || media.title,
          usedConfigId: false,
        };
      }
    }

    console.log("[result] No poster found, returning null");
    return { poster: null, showTitle: null, usedConfigId: false };

  } catch (error) {
    console.error("Error fetching poster:", error.message);
    return { poster: null, showTitle: null, usedConfigId: false };
  }
};

module.exports = fetchPoster;
