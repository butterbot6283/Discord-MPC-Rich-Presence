const axios = require("axios");
const fs = require('fs');
const path = require('path');
const { parseSeasonEpisode, _baseHash } = require('./utils');

const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/w500";

const getTmdbToken = (config) => {
    if (config.personal_tmdb_token && config.personal_tmdb_token.trim() !== "") {
        return config.personal_tmdb_token.trim();
    }
    return Buffer.from(_baseHash.split('').reverse().join(''), 'base64').toString('utf-8');
};

const formatApiDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parts[0];
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (isNaN(month) || isNaN(day)) return dateStr;
    return `${months[month - 1]} ${day}, ${year}`;
};

// 1. TARIK SEMUANYA TANPA TERKECUALI (Omni-Fetch)
const fetchTmdbDetails = async (id, type, config, season, episode, groupID, apiToken) => {
    try {
        const res = await axios.get(`https://api.themoviedb.org/3/${type}/${id}?append_to_response=alternative_titles,images&include_image_language=en,null`, {
            headers: { Authorization: `Bearer ${apiToken}` }, timeout: 8000
        });
        const data = res.data;

        let standardTitle = data.name || data.title;
        let romajiTitle = null;

        // Tarik Romaji secara paksa untuk di-cache
        if (data.alternative_titles) {
            const altTitles = data.alternative_titles.results || data.alternative_titles.titles || [];
            const romajiList = altTitles.filter(t => t.iso_3166_1 === 'JP' && (t.type?.toLowerCase() === 'romaji' || t.type?.toLowerCase() === 'transliteration'));
            if (romajiList.length > 0) {
                const cleanRomaji = romajiList.find(t => !/[āēīōūĀĒĪŌŪ]/.test(t.title));
                romajiTitle = cleanRomaji ? cleanRomaji.title : romajiList[0].title; 
            }
        }

        // Tarik Poster secara paksa
        let finalPosters = [];
        if (data.images && data.images.posters && data.images.posters.length > 0) {
            const filtered = data.images.posters.filter(p => p.iso_639_1 === 'en' || p.iso_639_1 === null);
            if (filtered.length > 0) finalPosters = filtered.map(p => `${tmdbBaseImageUrl}${p.file_path}`);
        }
        if (finalPosters.length === 0 && data.poster_path) finalPosters = [`${tmdbBaseImageUrl}${data.poster_path}`];

        let fetchedEpisodes = {};

        // Tarik Seluruh Episode (Preload) secara paksa
        if (type === 'tv') {
            try {
                if (groupID) {
                    const groupRes = await axios.get(`https://api.themoviedb.org/3/tv/episode_group/${groupID}`, { headers: { Authorization: `Bearer ${apiToken}` }, timeout: 8000 });
                    const targetSeason = season !== null ? season : 1;
                    const targetGroup = groupRes.data.groups.find(g => g.order === targetSeason) || groupRes.data.groups[targetSeason - 1];
                    
                    if (targetGroup && targetGroup.episodes) {
                        targetGroup.episodes.forEach(ep => {
                            const epNum = ep.order + 1;
                            fetchedEpisodes[`GROUP_S${targetSeason}E${epNum}`] = {
                                tmdbEpisodeTitle: ep.name && !ep.name.toLowerCase().startsWith('episode ') ? ep.name : null,
                                tmdbReleaseDate: ep.air_date || null
                            };
                        });
                    }
                } else {
                    const targetSeason = season !== null ? season : 1;
                    const epRes = await axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${targetSeason}`, { headers: { Authorization: `Bearer ${apiToken}` }, timeout: 5000 });
                    epRes.data.episodes.forEach(ep => {
                        fetchedEpisodes[`S${targetSeason}E${ep.episode_number}`] = {
                            tmdbEpisodeTitle: ep.name && !ep.name.toLowerCase().startsWith('episode ') ? ep.name : null,
                            tmdbReleaseDate: ep.air_date || null
                        };
                    });
                }
            } catch(e) {}
        }

        return { posters: finalPosters, showTitle: standardTitle, romajiTitle: romajiTitle, fetchedEpisodes };
    } catch (err) { return null; }
};

const fetchPoster = async (tmdbID, malID, groupID, actualFilePath, cleanedName) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
  const API_TOKEN = getTmdbToken(config);
  
  const rawTitle = cleanedName.replace(/\.+[a-zA-Z0-9]+$/, "");
  const fileBasename = actualFilePath ? path.basename(actualFilePath) : cleanedName;
  const folderPath = actualFilePath ? path.dirname(actualFilePath) : __dirname;
  
  const isTv = /(?:Season|Book|Part|S\d+E\d+|Episode\s*\d+|Ep\s*\d+|E\d{1,4}|\s-\s*\d{1,4})/i.test(rawTitle);
  const { season, episode } = parseSeasonEpisode(rawTitle); 
  
  let year = null;
  let cleanTitleForSearch = rawTitle.replace(/\[.*?\]/g, ''); 

  const yearMatch = cleanTitleForSearch.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
      year = yearMatch[1];
      cleanTitleForSearch = cleanTitleForSearch.substring(0, yearMatch.index).trim();
  }

  cleanTitleForSearch = cleanTitleForSearch
      .replace(/[_\-\s]+(?:S\d+E\d+|Season|Book|Part|Episode|Ep|E)\s*\d+.*/i, '')
      .replace(/[_\-\s]*[_\-]+[_\-\d\s]+$/, '') 
      .replace(/S\d+E\d+.*/i, '')
      .replace(/(?:Season|Book|Part|Episode|Ep)\s*\d+.*/i, '')
      .replace(/\bE\d{1,4}\b.*/i, '')
      .replace(/\b(BD|DVD|HD|Dub Indonesia|Dubbed|Dub|Sub|Raw|OVA|ONA|NC|Creditless)\b/gi, '') 
      .replace(/[\._\-]/g, ' ') 
      .replace(/\s{2,}/g, ' ') 
      .trim();

  // apiErrors: menyimpan pesan error nyata (timeout, network down, dll) agar logger
  // bisa membedakan "benar-benar tidak ketemu" vs "gagal karena error"
  let debugInfo = { cleanTitle: cleanTitleForSearch, year: year, searchedTmdb: false, apiErrors: [] };

  // =====================================================================
  // SISTEM MANAJEMEN CACHE LOKAL (OMNI-CACHE)
  // =====================================================================
  const cacheFilePath1 = path.join(folderPath, 'rpc_cache.json');
  const cacheFilePath2 = path.join(__dirname, 'rpc_cache.json'); 
  
  let targetCachePath = cacheFilePath1; 
  
  try {
      fs.accessSync(folderPath, fs.constants.W_OK); 
      if (fs.existsSync(cacheFilePath2)) {
          try { fs.unlinkSync(cacheFilePath2); } catch (e) {}
      }
  } catch (err) { targetCachePath = cacheFilePath2; }

  let cacheData = {};
  try {
      if (fs.existsSync(targetCachePath)) cacheData = JSON.parse(fs.readFileSync(targetCachePath, 'utf-8'));
  } catch(e) {}

  // KUNCI SAKTI: Semua visual switches (autoPoster/Ep/Romaji) DIHAPUS dari validasi cache!
  // Cache sekarang akan permanen kecuali id group atau filter NSFW (dont) diubah.
  const currentConfigState = `${config.dont}-GRP:${!!groupID}`;
  const cacheKey = tmdbID || config.tmdb_id || malID || config.mal_id || cleanTitleForSearch;
  const targetSeason = season !== null ? season : 1;
  const epKey = groupID ? `GROUP_S${targetSeason}E${episode}` : `S${targetSeason}E${episode}`;

  // 2. FASE BACA CACHE
  if (cacheData[cacheKey] && cacheData[cacheKey].configState === currentConfigState) {
      const seriesData = cacheData[cacheKey];
      let epData = seriesData.episodes ? seriesData.episodes[fileBasename] : null;
      
      if (!epData && seriesData.episodes && seriesData.episodes[epKey]) {
          epData = seriesData.episodes[epKey];
          seriesData.episodes[fileBasename] = epData;
          delete seriesData.episodes[epKey];
          try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (e) {}
      }
      
      // Pilih Romaji atau Standar. JIKA autoPoster OFF, kosongkan showTitle agar memicu format Override!
      let finalShowTitle = (config.romajiTitle && seriesData.romajiTitle) ? seriesData.romajiTitle : seriesData.showTitle;
      if (!config.autoPoster) finalShowTitle = null;

      if (!isTv || epData) {
          return {
              posters: seriesData.posters || [], 
              showTitle: finalShowTitle, 
              tmdbUrl: seriesData.tmdbUrl,
              tmdbEpisodeTitle: epData ? epData.tmdbEpisodeTitle : null,
              tmdbReleaseDate: epData ? epData.tmdbReleaseDate : null,
              source: `[CACHE] ` + (epData ? epData.source : seriesData.source || 'TMDb'),
              retry: false, debugInfo: seriesData.debugInfo
          };
      }
  }

  // 3. FASE SIMPAN CACHE (Preload & Omni-Save)
  const saveCacheAndReturn = (result) => {
      if (!result.retry) {
          if (!cacheData[cacheKey] || cacheData[cacheKey].configState !== currentConfigState) {
              cacheData[cacheKey] = {
                  configState: currentConfigState, 
                  showTitle: result.showTitle, 
                  romajiTitle: result.romajiTitle, // Simpan ke json!
                  posters: result.posters,
                  tmdbUrl: result.tmdbUrl, 
                  source: result.source.replace('[CACHE] ', ''), 
                  debugInfo: result.debugInfo,
                  episodes: {} 
              };
          }
          
          if (result.fetchedEpisodes) {
              for (const [key, data] of Object.entries(result.fetchedEpisodes)) {
                  cacheData[cacheKey].episodes[key] = {
                      tmdbEpisodeTitle: data.tmdbEpisodeTitle,
                      tmdbReleaseDate: formatApiDate(data.tmdbReleaseDate),
                      source: result.source.replace('[CACHE] ', '')
                  };
              }
          }

          let currentEpData = null;
          if (cacheData[cacheKey].episodes[epKey]) {
              currentEpData = cacheData[cacheKey].episodes[epKey];
              cacheData[cacheKey].episodes[fileBasename] = currentEpData;
              delete cacheData[cacheKey].episodes[epKey];
          } else if (cacheData[cacheKey].episodes[fileBasename]) {
              currentEpData = cacheData[cacheKey].episodes[fileBasename];
          }

          // Output akhir dikembalikan sesuai dengan switch romajiTitle & autoPoster di config.
          result.showTitle = (config.romajiTitle && result.romajiTitle) ? result.romajiTitle : result.showTitle;
          if (!config.autoPoster) result.showTitle = null;
          
          result.tmdbEpisodeTitle = currentEpData ? currentEpData.tmdbEpisodeTitle : null;
          result.tmdbReleaseDate = currentEpData ? currentEpData.tmdbReleaseDate : null;
          
          try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (err) {}
      }
      return result;
  };
  // =====================================================================

  try {
    const targetMal = malID || config.mal_id;
    if (targetMal) {
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${targetMal}`, { timeout: 8000 });
      let psts = res.data.data?.images?.jpg?.large_image_url ? [res.data.data.images.jpg.large_image_url] : [];
      let stit = res.data.data.title_english || res.data.data.title; 
      let rtit = res.data.data.title; // Default MAL biasanya sudah Romaji
      
      if (psts.length > 0 || stit) return saveCacheAndReturn({ posters: psts, showTitle: stit, romajiTitle: rtit, fetchedEpisodes: null, tmdbUrl: null, retry: false, source: 'Jikan (via MAL)', debugInfo });
    }

    const checkTmdbId = async (id, sourceName, isTvCheck) => {
        const primaryType = isTvCheck ? 'tv' : 'movie';
        const fallbackType = isTvCheck ? 'movie' : 'tv';
        try {
            await axios.get(`https://api.themoviedb.org/3/${primaryType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
            const details = await fetchTmdbDetails(id, primaryType, config, season, episode, groupID, API_TOKEN);
            if (details) return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${primaryType}/${id}`, retry: false, source: sourceName, debugInfo });
        } catch (e) {
            // ID valid tapi tipe (tv/movie) salah -> coba tipe sebaliknya sebelum menyerah
            const isNotFound = e.response && e.response.status === 404;
            if (!isNotFound) debugInfo.apiErrors.push(`TMDb ID lookup (${primaryType}): ${e.code || e.message}`);
            try {
                await axios.get(`https://api.themoviedb.org/3/${fallbackType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
                const details = await fetchTmdbDetails(id, fallbackType, config, season, episode, groupID, API_TOKEN); 
                if (details) return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${fallbackType}/${id}`, retry: false, source: sourceName + ` (Fallback to ${fallbackType.toUpperCase()})`, debugInfo });
            } catch (err) {
                const fallbackNotFound = err.response && err.response.status === 404;
                if (!fallbackNotFound) debugInfo.apiErrors.push(`TMDb ID lookup (${fallbackType}): ${err.code || err.message}`);
            }
        }
        return null;
    };

    if (tmdbID && API_TOKEN) {
        const result = await checkTmdbId(tmdbID, 'TMDb (via tmdb.txt/ID)', isTv);
        if (result) return result; 
    }
    if (config.tmdb_id && API_TOKEN) {
        const result = await checkTmdbId(config.tmdb_id, 'TMDb (via config.json)', isTv);
        if (result) return result;
    }

    if (cleanTitleForSearch) {
      const type = isTv ? "tv" : "movie";
      let tmdbSearchUrl = `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(cleanTitleForSearch)}&language=en-US&page=1`;
      if (year) tmdbSearchUrl += type === 'movie' ? `&primary_release_year=${year}` : `&first_air_date_year=${year}`;
      if (config.dont === 'nah') tmdbSearchUrl += '&include_adult=true';
      debugInfo.searchedTmdb = true; 
      
      try {
          const resTmdb = await axios.get(tmdbSearchUrl, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 8000 });
          const media = resTmdb.data.results?.[0];
          if (media) {
            const details = await fetchTmdbDetails(media.id, type, config, season, episode, groupID, API_TOKEN);
            if (details) return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${type}/${media.id}`, retry: false, source: `TMDb (AutoPoster - ${type.toUpperCase()})`, debugInfo });
          }
          
          const fallbackType = isTv ? "movie" : "tv";
          let fallbackUrl = `https://api.themoviedb.org/3/search/${fallbackType}?query=${encodeURIComponent(cleanTitleForSearch)}&language=en-US&page=1`;
          if (year) fallbackUrl += fallbackType === 'movie' ? `&primary_release_year=${year}` : `&first_air_date_year=${year}`;
          if (config.dont === 'nah') fallbackUrl += '&include_adult=true';
          
          const resFallback = await axios.get(fallbackUrl, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 8000 });
          const fallbackMedia = resFallback.data.results?.[0];
          if (fallbackMedia) {
            const details = await fetchTmdbDetails(fallbackMedia.id, fallbackType, config, season, episode, groupID, API_TOKEN);
            if (details) return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${fallbackType}/${fallbackMedia.id}`, retry: false, source: `TMDb (AutoPoster - Fallback to ${fallbackType.toUpperCase()})`, debugInfo });
          }
      } catch(err) {
          // Pencarian filename gagal total (network down, rate limit, dll) -> catat agar logger tahu
          debugInfo.apiErrors.push(`TMDb filename search: ${err.code || err.message}`);
      }
    }

    return saveCacheAndReturn({ posters: [], showTitle: null, romajiTitle: null, fetchedEpisodes: null, tmdbUrl: null, retry: false, source: 'Not Found', debugInfo });
  } catch (err) {
      // Error tak terduga di luar semua try/catch internal (mis. Jikan down, config.json rusak)
      debugInfo.apiErrors.push(`Unexpected: ${err.code || err.message}`);
      return { posters: [], showTitle: null, romajiTitle: null, fetchedEpisodes: null, tmdbUrl: null, retry: true, source: 'Error', debugInfo };
  }
};

module.exports = fetchPoster;
