const axios = require("axios");
const fs = require('fs');
const path = require('path');

// API Keys
const TMDB_API_TOKEN = "";
const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/original";

const fetchPoster = async (imdbID, malID, filePath) => {
  // Ambil config json
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

  // ==========================================
  // SMART PARSING: Tipe, Tahun, & Judul Bersih
  // ==========================================
  const rawTitle = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");

  // Deteksi TV/Movie (Mengenali Season, Book, Part, Ep, dsb)
  const isTv = /(?:Season|Book|Part|S\d+E\d+|Episode\s*\d+|Ep\s*\d+|E\d{1,4})/i.test(filePath);

  let year = null;
  let cleanTitleForSearch = rawTitle.replace(/\[.*?\]/g, ''); // Hapus tag grup (contoh: [Kusonime])

  // Cari Tahun (19XX atau 20XX) di dalam nama file
  const yearMatch = cleanTitleForSearch.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = yearMatch[1];
    // Potong judul hanya sampai sebelum tahun (biasanya tahun ada di akhir judul film)
    cleanTitleForSearch = cleanTitleForSearch.substring(0, yearMatch.index).trim();
  }

  // Bersihkan sisa-sisa atribut episode agar TMDb tidak bingung
  cleanTitleForSearch = cleanTitleForSearch
  .replace(/S\d+E\d+.*/i, '') // Hapus S01E01 dkk
  .replace(/(?:Season|Book|Part|Episode|Ep)\s*\d+.*/i, '') // Hapus tulisan Season dkk
  .replace(/[\._\-]/g, ' ') // Ganti titik dan strip jadi spasi
  .trim();

  try {
    if (malID) {
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${malID}`, { timeout: 8000 });
      if (res.data.data?.images?.jpg?.large_image_url) {
        return { poster: res.data.data.images.jpg.large_image_url, showTitle: res.data.data.title, retry: false };
      }
    }

    if (imdbID && TMDB_API_TOKEN) {
      const res = await axios.get(`https://api.themoviedb.org/3/find/${imdbID}?external_source=imdb_id`, {
        headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }, timeout: 8000
      });
      const media = res.data.tv_results?.[0] || res.data.movie_results?.[0];
      if (media?.poster_path) {
        return { poster: `${tmdbBaseImageUrl}${media.poster_path}`, showTitle: media.name || media.title, retry: false };
      }
    }

    if (config.mal_id) {
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${config.mal_id}`, { timeout: 8000 });
      if (res.data.data?.images?.jpg?.large_image_url) {
        return { poster: res.data.data.images.jpg.large_image_url, showTitle: res.data.data.title, retry: false };
      }
    }

    if (config.imdb_id && TMDB_API_TOKEN) {
      const res = await axios.get(`https://api.themoviedb.org/3/find/${config.imdb_id}?external_source=imdb_id`, {
        headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }, timeout: 8000
      });
      const media = res.data.tv_results?.[0] || res.data.movie_results?.[0];
      if (media?.poster_path) {
        return { poster: `${tmdbBaseImageUrl}${media.poster_path}`, showTitle: media.name || media.title, retry: false };
      }
    }

    // === AUTO-POSTER DENGAN FILTER TAHUN ===
    if (config.autoPoster && cleanTitleForSearch) {
      const type = isTv ? "tv" : "movie";

      // Susun URL Pencarian TMDb
      let tmdbSearchUrl = `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(cleanTitleForSearch)}&language=en-US&page=1`;

      // Jika tahun ditemukan, tambahkan filter spesifik
      if (year) {
        if (type === 'movie') tmdbSearchUrl += `&primary_release_year=${year}`;
        if (type === 'tv') tmdbSearchUrl += `&first_air_date_year=${year}`;
      }

      const res = await axios.get(tmdbSearchUrl, {
        headers: { Authorization: `Bearer ${TMDB_API_TOKEN}` }, timeout: 8000
      });

      const media = res.data.results?.[0];
      if (media?.poster_path) {
        return { poster: `${tmdbBaseImageUrl}${media.poster_path}`, showTitle: null, retry: false };
      }
    }

    return { poster: null, showTitle: null, retry: true };

  } catch (err) {
    return { poster: null, showTitle: null, retry: true };
  }
};

module.exports = fetchPoster;
