const axios = require("axios");
const { filenameParse } = require("@ctrl/video-filename-parser");

// === API Keys ===
const OMDB_API_KEY = ""; // isi manual

// === Fix OMDb Poster URL ===
const fixOmdbPosterUrl = (url) => {
  if (url && url.includes("._V1_SX300")) {
    return url.replace(/\._V1_SX300/, "");
  }
  return url;
};

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

const fetchPoster = async (imdbID, malID, filePath) => {
  delete require.cache[require.resolve("./config")];
  const config = require("./config");

  // Parse filename
  const parsed = filenameParse(filePath, true);
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
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, usedConfigId: false };
      }
    }

    // === Prioritas 2: IMDb ID (OMDb) ===
    if (imdbID && OMDB_API_KEY) {
      console.log(`[api] Fetching from OMDb using IMDb_ID: ${imdbID}`);
      const omdbUrl = `https://www.omdbapi.com/?i=${imdbID}&apikey=${OMDB_API_KEY}`;
      const response = await axios.get(omdbUrl);
      const data = response.data;
      if (data?.Poster && data?.Poster !== "N/A") {
        const fixedPoster = fixOmdbPosterUrl(data.Poster);
        return { poster: fixedPoster, showTitle: data.Title, usedConfigId: false };
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

    // === Prioritas 4: Config IMDb ID (OMDb) ===
    if (config.imdb_id && OMDB_API_KEY) {
      console.log(`[api] Fetching from OMDb using config.imdb_id: ${config.imdb_id}`);
      const omdbUrl = `https://www.omdbapi.com/?i=${config.imdb_id}&apikey=${OMDB_API_KEY}`;
      const response = await axios.get(omdbUrl);
      const data = response.data;
      if (data?.Poster && data?.Poster !== "N/A") {
        const fixedPoster = fixOmdbPosterUrl(data.Poster);
        return { poster: fixedPoster, showTitle: data.Title, usedConfigId: true };
      }
    }

    // === Prioritas 5: AutoPoster pakai title (Jikan) ===
    if (config.autoPoster && title) {
      console.log(`[api] Searching Jikan with title: "${title}"`);
      const jikanUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`;
      const response = await axios.get(jikanUrl);
      const anime = response.data.data[0];
      if (anime?.images?.jpg?.large_image_url) {
        return { poster: anime.images.jpg.large_image_url, showTitle: anime.title, usedConfigId: false };
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
