// metadata.js
const axios = require("axios");
const fs = require('fs');
const path = require('path');
const { parseSeasonEpisode, _baseHash } = require('./utils');

const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/w500";
const POSTER_CACHE_VERSION = 2;

const mergeUniquePosters = (...lists) => {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const poster of list) {
            if (!poster || seen.has(poster)) continue;
            seen.add(poster);
            merged.push(poster);
        }
    }
    return merged;
};

const selectCachedPosters = (seriesData, config) => {
    const englishPosters = Array.isArray(seriesData.posters) ? seriesData.posters : [];
    const japanesePosters = Array.isArray(seriesData.postersJa) ? seriesData.postersJa : [];

    if (config.romajiTitle && seriesData.originalLanguage === 'ja') {
        return mergeUniquePosters(englishPosters, japanesePosters);
    }

    return englishPosters;
};

const EPISODE_PATTERN = /(?:(?:Season|Book|Part)\s*\d+|S\d+)?[\s._-]*(?:Ep(?:isode)?\s*)?0*(\d{1,4})(?=\.|_|\s|\[|$)/i;

const loadTitles = (videoDir) => {
    try {
        const files = fs.readdirSync(videoDir).filter(file =>
        file.match(/^titles\.txt$/) || file.match(/^titles_s\d+\.txt$/)
        );

        if (files.length > 1) return { titles: [], titlesFile: null };
        if (files.length === 0) return { titles: [], titlesFile: null };

        const titlesFile = files[0];
        const titlesFilePath = path.join(videoDir, titlesFile);
        const titles = [];
        const lines = fs.readFileSync(titlesFilePath, 'utf-8').split('\n');
        for (const line of lines) {
            const parts = line.trim().split('|');
            if (parts.length === 3) {
                try {
                    const episode_number = parseInt(parts[0]);
                    titles.push({ episode_number, title: parts[1], release_date: parts[2] });
                } catch (error) {}
            }
        }
        return { titles, titlesFile };
    } catch (err) {
        return { titles: [], titlesFile: null };
    }
};

const fetchIdsFromTxt = (videoDir) => {
    let tmdbID = null, groupID = null, malID = null;
    try {
        const tmdbFilePath = path.join(videoDir, 'tmdb.txt');
        const groupFilePath = path.join(videoDir, 'group.txt');
        const malFilePath = path.join(videoDir, 'mal.txt');

        if (fs.existsSync(tmdbFilePath)) {
            const tmdbContent = fs.readFileSync(tmdbFilePath, 'utf-8').trim();
            if (tmdbContent && !isNaN(tmdbContent)) tmdbID = tmdbContent;
        }
        if (fs.existsSync(groupFilePath)) {
            const groupContent = fs.readFileSync(groupFilePath, 'utf-8').trim();
            if (groupContent) groupID = groupContent;
        }
        if (fs.existsSync(malFilePath)) {
            const malContent = fs.readFileSync(malFilePath, 'utf-8').trim();
            if (malContent && /^\d+$/.test(malContent)) malID = malContent;
        }
        return { tmdbID, groupID, malID };
    } catch (err) {
        return { tmdbID: null, groupID: null, malID: null };
    }
};

const fetchTitles = async (filename, filePath) => {
    const { filenameParse } = await import('@ctrl/video-filename-parser');
    const videoDir = filePath ? path.dirname(filePath) : '.';
    const { titles, titlesFile } = loadTitles(videoDir);
    let episode = null;
    let forcedSeason = null;

    if (titlesFile) {
        const matchSeason = titlesFile.match(/^titles_s(\d+)\.txt$/);
        if (matchSeason) forcedSeason = parseInt(matchSeason[1], 10);
    }

    const info = filenameParse(filename, true);
    if (info.episodeNumbers && info.episodeNumbers.length > 0) {
        episode = parseInt(info.episodeNumbers[0]);
    } else {
        const match = filename.match(EPISODE_PATTERN);
        if (match) episode = parseInt(match[1]);
    }

    if (episode && titles.length > 0) {
        const matchingEpisode = titles.find(item => item.episode_number === episode);
        if (matchingEpisode) {
            const isSeasonFile = titlesFile && titlesFile.match(/^titles_s(\d+)\.txt$/);
            let episodeTitle;
            if (isSeasonFile) {
                const seasonNum = parseInt(isSeasonFile[1]).toString().padStart(2, '0');
                episodeTitle = `S${seasonNum}E${matchingEpisode.episode_number.toString().padStart(2, '0')}: ${matchingEpisode.title}`;
            } else {
                episodeTitle = `Episode ${matchingEpisode.episode_number.toString().padStart(2, '0')}: ${matchingEpisode.title}`;
            }
            return { episodeTitle, releaseDate: matchingEpisode.release_date, forcedSeason, debugInfo: { parsedEpisode: episode, titlesFile, loadedCount: titles.length } };
        }
    }
    return { episodeTitle: null, releaseDate: null, forcedSeason, debugInfo: { parsedEpisode: episode, titlesFile, loadedCount: titles.length } };
};

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

const cleanTitleForAnilist = (title) => {
    if (!title) return title;
    return title
        .replace(/\b(?:S|Season|Part|Cour)\s*\d+\b/ig, '')
        .replace(/\s+(?:\d{1,3}|[IVX]+)$/ig, '')
        .replace(/[\(\)\[\]]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
};

const fetchAnilistTitleByMalId = async (malID) => {
    if (!malID) return { title: null, idMal: null, error: null, matchMode: null };
    try {
        const query = `
        query ($idMal: Int) {
            Media (idMal: $idMal, type: ANIME) {
                idMal
                format
                title { romaji }
            }
        }
        `;
        const response = await axios.post('https://graphql.anilist.co', {
            query,
            variables: { idMal: Number(malID) }
        }, { timeout: 5000 });

        const media = response.data?.data?.Media;
        if (!media) {
            return { title: null, idMal: null, error: `MAL ID ${malID} not found on AniList`, matchMode: null };
        }

        return {
            title: media.title?.romaji || null,
            idMal: media.idMal || Number(malID),
            format: media.format || null,
            error: null,
            matchMode: 'mal.txt'
        };
    } catch (error) {
        return { title: null, idMal: null, error: error.code || error.message, matchMode: null };
    }
};

const fetchAnilistTitle = async (searchQuery, targetDate, targetSeasonNum) => {
    if (!searchQuery) return { title: null, idMal: null, error: null, matchMode: null };
    if (!targetDate) return { title: null, idMal: null, error: 'TMDb premiere date unavailable for exact AniList matching', matchMode: null };

    try {
        const query = `
        query ($search: String) {
            Page(page: 1, perPage: 20) {
                media (search: $search, type: ANIME) {
                    idMal
                    format
                    title { romaji }
                    startDate { year month day }
                }
            }
        }
        `;
        const response = await axios.post('https://graphql.anilist.co', {
            query,
            variables: { search: searchQuery }
        }, { timeout: 5000 });

        const mediaList = response.data?.data?.Page?.media || [];
        if (mediaList.length === 0) {
            return { title: null, idMal: null, error: 'AniList returned no search results', matchMode: null };
        }

        const exactDateMatches = mediaList.filter(m => {
            if (!m.startDate?.year || !m.startDate?.month || !m.startDate?.day) return false;
            return `${m.startDate.year}-${String(m.startDate.month).padStart(2,'0')}-${String(m.startDate.day).padStart(2,'0')}` === targetDate;
        });

        if (exactDateMatches.length === 0) {
            return { title: null, idMal: null, error: `No exact startDate match for ${targetDate}`, matchMode: null };
        }

        let candidates = exactDateMatches;
        if (targetSeasonNum === 0) {
            candidates = candidates.filter(m => ['OVA', 'ONA', 'SPECIAL'].includes(m.format) || (m.title?.romaji && /OVA|ONA|Special/i.test(m.title.romaji)));
        } else {
            candidates = candidates.filter(m => !['OVA', 'ONA', 'SPECIAL'].includes(m.format) && !(m.title?.romaji && /OVA|ONA|Special/i.test(m.title.romaji)));
        }

        if (candidates.length === 0) {
            return { title: null, idMal: null, error: `Exact date ${targetDate} matched, but no compatible AniList format remained for TMDb Season ${targetSeasonNum}`, matchMode: null };
        }
        if (candidates.length > 1) {
            const names = candidates.map(m => `${m.title?.romaji || 'Untitled'} [${m.format || 'UNKNOWN'}, MAL ${m.idMal || 'N/A'}]`).join('; ');
            return { title: null, idMal: null, error: `Exact date ${targetDate} produced multiple compatible candidates: ${names}`, matchMode: null };
        }

        const bestMatch = candidates[0];
        return {
            title: bestMatch.title?.romaji || null,
            idMal: bestMatch.idMal || null,
            format: bestMatch.format || null,
            error: null,
            matchMode: 'date-exact'
        };
    } catch (error) {
        return { title: null, idMal: null, error: error.code || error.message, matchMode: null };
    }
};

const fetchTmdbDetails = async (id, type, config, season, episode, groupID, malID, apiToken, cleanTitleForSearch, debugInfo) => {
    try {
        const res = await axios.get(`https://api.themoviedb.org/3/${type}/${id}?append_to_response=alternative_titles,images&include_image_language=en,null`, {
            headers: { Authorization: `Bearer ${apiToken}` }, timeout: 8000
        });
        const data = res.data;
        const originalLanguage = data.original_language || null;

        let standardTitle = data.name || data.title;
        let romajiTitle = null;
		let tagline = data.tagline && data.tagline.trim() !== "" ? data.tagline.trim() : null;
        let mainReleaseDate = data.release_date || data.first_air_date || null;

        if (data.alternative_titles) {
            const altTitles = data.alternative_titles.results || data.alternative_titles.titles || [];
            const romajiList = altTitles.filter(t => t.iso_3166_1 === 'JP' && (t.type?.toLowerCase() === 'romaji' || t.type?.toLowerCase() === 'transliteration'));
            if (romajiList.length > 0) {
                const cleanRomaji = romajiList.find(t => !/[āēīōūĀĒĪŌŪ]/.test(t.title));
                romajiTitle = cleanRomaji ? cleanRomaji.title : romajiList[0].title;
            }
        }

        // =========================================================
        // TMDb SEASON PRE-LOAD
        // =========================================================
        let fetchedEpisodes = {};

        if (type === 'tv') {
            try {
                if (groupID) {
                    const groupRes = await axios.get(`https://api.themoviedb.org/3/tv/episode_group/${groupID}`, { headers: { Authorization: `Bearer ${apiToken}` }, timeout: 8000 });
                    const targetSeason = season !== null ? season : 1;
                    const targetGroup = groupRes.data.groups.find(g => g.order === targetSeason) || groupRes.data.groups[targetSeason - 1];

                    if (targetGroup) {
                        if (targetGroup.episodes) {
                            targetGroup.episodes.forEach(ep => {
                                const epNum = ep.order + 1;
                                fetchedEpisodes[`GROUP_S${targetSeason}E${epNum}`] = {
                                    tmdbEpisodeTitle: ep.name && !ep.name.toLowerCase().startsWith('episode ') ? ep.name : null,
                                    tmdbReleaseDate: ep.air_date || null 
                                };
                            });
                        }
                    }
                } else {
                    const targetSeason = season !== null ? season : 1;
                    const epRes = await axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${targetSeason}`, { headers: { Authorization: `Bearer ${apiToken}` }, timeout: 5000 });

                    if (epRes.data.episodes) {
                        epRes.data.episodes.forEach(ep => {
                            fetchedEpisodes[`S${targetSeason}E${ep.episode_number}`] = {
                                tmdbEpisodeTitle: ep.name && !ep.name.toLowerCase().startsWith('episode ') ? ep.name : null,
                                tmdbReleaseDate: ep.air_date || null 
                            };
                        });
                    }
                }
            } catch(e) {}
        }

        // =========================================================
        // ANILIST LOGIC
        // 1) mal.txt = absolute lookup by MAL ID
        // 2) otherwise exact TMDb premiere date + format matching
        // =========================================================
        let anilistTitle = null;
        let anilistIdMal = null;
        let anilistMatchMode = null;

        if (config.romajiTitle && data.original_language === 'ja') {
            const anilistQuery = cleanTitleForAnilist(cleanTitleForSearch);
            let targetDate = null;
            let targetSeasonNum = null;

            if (type === 'tv') {
                targetSeasonNum = season !== null ? season : 1;
                const ep1Key = groupID ? `GROUP_S${targetSeasonNum}E1` : `S${targetSeasonNum}E1`;
                let ep1Data = fetchedEpisodes[ep1Key];
                if (!ep1Data) ep1Data = Object.values(fetchedEpisodes)[0];
                if (ep1Data?.tmdbReleaseDate) targetDate = ep1Data.tmdbReleaseDate;
            } else if (type === 'movie') {
                targetSeasonNum = 1;
                targetDate = mainReleaseDate;
            }

            if (malID) {
                const malResult = await fetchAnilistTitleByMalId(malID);
                if (malResult.title) {
                    anilistTitle = malResult.title;
                    anilistIdMal = malResult.idMal;
                    anilistMatchMode = 'mal.txt';
                } else if (debugInfo) {
                    debugInfo.apiErrors.push(`AniList MAL lookup failed for MAL ID ${malID}: ${malResult.error} -> fallback to TMDb`);
                }
            } else {
                const { title, idMal, error, matchMode } = await fetchAnilistTitle(anilistQuery, targetDate, targetSeasonNum);
                if (title) {
                    anilistTitle = title;
                    anilistIdMal = idMal;
                    anilistMatchMode = matchMode;
                } else if (debugInfo) {
                    const errMsg = error || `No exact date match for ${targetDate || 'unknown date'}`;
                    debugInfo.apiErrors.push(`AniList lookup failed for "${anilistQuery}": ${errMsg} -> fallback to TMDb`);
                }
            }
        }

        // =========================================================
        // POSTER LANGUAGE CACHE
        // =========================================================
        // posters   = English + no-language posters
        // postersJa = Japanese posters (only requested for original_language=ja)
        let englishPosters = [];
        if (data.images && data.images.posters && data.images.posters.length > 0) {
            englishPosters = data.images.posters
                .filter(p => p.iso_639_1 === 'en' || p.iso_639_1 === null)
                .map(p => `${tmdbBaseImageUrl}${p.file_path}`);
        }
        if (englishPosters.length === 0 && data.poster_path) {
            englishPosters = [`${tmdbBaseImageUrl}${data.poster_path}`];
        }
        englishPosters = mergeUniquePosters(englishPosters);

        let japanesePosters = [];
        if (originalLanguage === 'ja') {
            try {
                const imagesRes = await axios.get(`https://api.themoviedb.org/3/${type}/${id}/images?include_image_language=en,ja,null`, {
                    headers: { Authorization: `Bearer ${apiToken}` }, timeout: 8000
                });
                japanesePosters = mergeUniquePosters(
                    (imagesRes.data?.posters || [])
                        .filter(p => p.iso_639_1 === 'ja')
                        .map(p => `${tmdbBaseImageUrl}${p.file_path}`)
                );
            } catch (e) {}
        }

        const selectedPosters = (config.romajiTitle && originalLanguage === 'ja')
            ? mergeUniquePosters(englishPosters, japanesePosters)
            : englishPosters;

        return {
            posters: selectedPosters,
            postersEnglish: englishPosters,
            postersJa: japanesePosters,
            originalLanguage,
            showTitle: standardTitle,
            romajiTitle: romajiTitle,
            anilistTitle: anilistTitle,
            anilistIdMal: anilistIdMal,
            anilistMatchMode,
            fetchedEpisodes,
            tagline,
            mainReleaseDate
        };
    } catch (err) { return null; }
};

const fetchMetadata = async (tmdbID, groupID, malID, actualFilePath, cleanedName) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
  const API_TOKEN = getTmdbToken(config);
  
  const rawTitle = cleanedName.replace(/\.+[a-zA-Z0-9]+$/, "");
  const fileBasename = actualFilePath ? path.basename(actualFilePath) : cleanedName;
  const folderPath = actualFilePath ? path.dirname(actualFilePath) : __dirname;
  
  const isTv = /(?:Season|Book|Part|S\d+E\d+|Episode\s*\d+|Ep\s*\d+|E\d{1,4}|\s-\s*\d{1,4})/i.test(rawTitle);
  const { season: parsedSeason, episode } = parseSeasonEpisode(rawTitle); 
  let season = parsedSeason;

  const { titlesFile } = loadTitles(folderPath);
  if (titlesFile) {
      const matchSeason = titlesFile.match(/^titles_s(\d+)\.txt$/);
      if (matchSeason) season = parseInt(matchSeason[1], 10);
  }
  
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
      .replace(/[\._\-\(\)\[\]]/g, ' ') 
      .replace(/\s{2,}/g, ' ') 
      .trim();

  let debugInfo = { cleanTitle: cleanTitleForSearch, year: year, searchedTmdb: false, apiErrors: [] };

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

  const currentConfigState = `${config.dont}-GRP:${!!groupID}`;
  const cacheKey = tmdbID || config.tmdb_id || cleanTitleForSearch;
  const targetSeason = season !== null ? season : 1;
  const epKey = groupID ? `GROUP_S${targetSeason}E${episode}` : `S${targetSeason}E${episode}`;

  const resolveTitleAndUrl = (cData, seasonNum) => {
      const seasonOverride = cData.seasonTitles && cData.seasonTitles[seasonNum];
      let title = cData.showTitle;
      let url = cData.tmdbUrl;
      let sourceDebug = 'tmdb';

      if (config.romajiTitle) {
          if (seasonOverride && seasonOverride.title) {
              title = seasonOverride.title;
              sourceDebug = 'anilist';
              if (seasonOverride.idMal) {
                  url = `https://myanimelist.net/anime/${seasonOverride.idMal}`;
              }
          } else if (cData.romajiTitle) {
              title = cData.romajiTitle;
              sourceDebug = 'tmdb alt';
          }
      }
      return { title, url, sourceDebug };
  };

  if (cacheData[cacheKey] && cacheData[cacheKey].configState === currentConfigState && cacheData[cacheKey].posterCacheVersion === POSTER_CACHE_VERSION) {
      const seriesData = cacheData[cacheKey];
      
      // =========================================================
      // AUTO-HYDRATION: Tarik AniList Jika Romaji ON Tapi Cache Kosong
      // =========================================================
      let seasonOverride = seriesData.seasonTitles && seriesData.seasonTitles[targetSeason];
      if (config.romajiTitle && malID && (!seasonOverride || seasonOverride.idMal !== Number(malID) || seasonOverride.source !== 'mal.txt')) {
          const malResult = await fetchAnilistTitleByMalId(malID);
          if (malResult.title) {
              if (!seriesData.seasonTitles) seriesData.seasonTitles = {};
              seriesData.seasonTitles[targetSeason] = {
                  title: malResult.title,
                  idMal: malResult.idMal,
                  source: 'mal.txt'
              };
              seasonOverride = seriesData.seasonTitles[targetSeason];
              try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (e) {}
          }
      }
      if (config.romajiTitle && !malID && (!seasonOverride || !seasonOverride.title)) {
          const ep1Key = groupID ? `GROUP_S${targetSeason}E1` : `S${targetSeason}E1`;
          let ep1Data = seriesData.episodes ? seriesData.episodes[ep1Key] : null;
          if (!ep1Data && seriesData.episodes) ep1Data = Object.values(seriesData.episodes)[0];

          const dateStr = ep1Data ? ep1Data.tmdbReleaseDate : seriesData.mainReleaseDate;
          let targetDate = null;
          if (dateStr) {
              const dateObj = new Date(dateStr);
              if (!isNaN(dateObj.getTime())) {
                  targetDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
              }
          }

          const anilistQuery = cleanTitleForAnilist(cleanTitleForSearch);
          const { title, idMal, matchMode } = await fetchAnilistTitle(anilistQuery, targetDate, targetSeason);
          
          if (title) {
              if (!seriesData.seasonTitles) seriesData.seasonTitles = {};
              seriesData.seasonTitles[targetSeason] = { 
                  title: title, 
                  idMal: idMal,
                  source: 'anilist',
                  matchMode: matchMode || 'date-exact' 
              };
              
              try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (e) {}
          }
      }

      let epData = seriesData.episodes ? seriesData.episodes[fileBasename] : null;
      if (!epData && seriesData.episodes && seriesData.episodes[epKey]) {
          epData = seriesData.episodes[epKey];
          seriesData.episodes[fileBasename] = epData;
          delete seriesData.episodes[epKey];
          try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (e) {}
      }
      
      const resolved = resolveTitleAndUrl(seriesData, targetSeason);
      let finalShowTitle = resolved.title;
      let finalMediaUrl = resolved.url;
      if (!config.autoPoster) finalShowTitle = null;

      if (!isTv || epData) {
          return {
              posters: selectCachedPosters(seriesData, config),
              showTitle: finalShowTitle, 
              mediaUrl: finalMediaUrl,
              titleSourceDebug: resolved.sourceDebug,
              anilistMatchMode: seasonOverride?.source === 'mal.txt' ? 'mal.txt' : (seasonOverride?.source === 'anilist' ? (seasonOverride.matchMode || 'date-exact') : null),
              tmdbEpisodeTitle: epData ? epData.tmdbEpisodeTitle : null,
              tmdbReleaseDate: epData ? epData.tmdbReleaseDate : (seriesData.mainReleaseDate || null),
              tmdbTagline: seriesData.tagline || null,
              source: `[CACHE] ` + (epData ? epData.source : seriesData.source || 'TMDb'),
              retry: false, debugInfo: seriesData.debugInfo
          };
      }
  }

  const saveCacheAndReturn = (result) => {
      if (!result.retry) {
          if (!cacheData[cacheKey] || cacheData[cacheKey].configState !== currentConfigState) {
              cacheData[cacheKey] = {
                  configState: currentConfigState,
                  posterCacheVersion: POSTER_CACHE_VERSION,
                  originalLanguage: result.originalLanguage || null,
                  showTitle: result.showTitle, 
                  romajiTitle: result.romajiTitle,
                  tagline: result.tagline || null,
                  mainReleaseDate: formatApiDate(result.mainReleaseDate) || null,
                  posters: result.postersEnglish || result.posters || [],
                  postersJa: result.postersJa || [],
                  tmdbUrl: result.tmdbUrl, 
                  source: result.source.replace('[CACHE] ', ''), 
                  debugInfo: result.debugInfo,
                  episodes: {},
                  seasonTitles: {} 
              };
          } else if (cacheData[cacheKey].posterCacheVersion !== POSTER_CACHE_VERSION) {
              // Refresh poster-language data for old caches without discarding
              // already cached episode or AniList season mappings.
              cacheData[cacheKey].posterCacheVersion = POSTER_CACHE_VERSION;
              cacheData[cacheKey].originalLanguage = result.originalLanguage || cacheData[cacheKey].originalLanguage || null;
              cacheData[cacheKey].posters = result.postersEnglish || result.posters || [];
              cacheData[cacheKey].postersJa = result.postersJa || [];
              if (result.showTitle) cacheData[cacheKey].showTitle = result.showTitle;
              if (result.romajiTitle) cacheData[cacheKey].romajiTitle = result.romajiTitle;
              if (result.tagline !== undefined) cacheData[cacheKey].tagline = result.tagline || null;
              if (result.mainReleaseDate) cacheData[cacheKey].mainReleaseDate = formatApiDate(result.mainReleaseDate) || cacheData[cacheKey].mainReleaseDate;
              if (result.tmdbUrl) cacheData[cacheKey].tmdbUrl = result.tmdbUrl;
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

          if (!cacheData[cacheKey].seasonTitles) cacheData[cacheKey].seasonTitles = {};
          if (result.anilistTitle) {
              cacheData[cacheKey].seasonTitles[targetSeason] = { 
                  title: result.anilistTitle, 
                  idMal: result.anilistIdMal,
                  source: 'anilist',
                  matchMode: result.anilistMatchMode || 'date-exact'
              };
          }

          let currentEpData = null;
          if (cacheData[cacheKey].episodes[epKey]) {
              currentEpData = cacheData[cacheKey].episodes[epKey];
              cacheData[cacheKey].episodes[fileBasename] = currentEpData;
              delete cacheData[cacheKey].episodes[epKey];
          } else if (cacheData[cacheKey].episodes[fileBasename]) {
              currentEpData = cacheData[cacheKey].episodes[fileBasename];
          }

          const resolved = resolveTitleAndUrl(cacheData[cacheKey], targetSeason);
          result.showTitle = resolved.title;
          result.mediaUrl = resolved.url;
          result.titleSourceDebug = resolved.sourceDebug;
          result.posters = selectCachedPosters(cacheData[cacheKey], config);

          if (!config.autoPoster) result.showTitle = null;
          
          result.tmdbEpisodeTitle = currentEpData ? currentEpData.tmdbEpisodeTitle : null;
          result.tmdbReleaseDate = currentEpData ? currentEpData.tmdbReleaseDate : cacheData[cacheKey].mainReleaseDate;
          result.tmdbTagline = cacheData[cacheKey].tagline;
          
          try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (err) {}
      }
      return result;
  };

  try {
    const checkTmdbId = async (id, sourceName, isTvCheck) => {
        const primaryType = isTvCheck ? 'tv' : 'movie';
        const fallbackType = isTvCheck ? 'movie' : 'tv';
        try {
            await axios.get(`https://api.themoviedb.org/3/${primaryType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
            const details = await fetchTmdbDetails(id, primaryType, config, season, episode, groupID, malID, API_TOKEN, cleanTitleForSearch, debugInfo);
            if (details) return saveCacheAndReturn({ posters: details.posters, postersEnglish: details.postersEnglish, postersJa: details.postersJa, originalLanguage: details.originalLanguage, showTitle: details.showTitle, romajiTitle: details.romajiTitle, anilistTitle: details.anilistTitle, anilistIdMal: details.anilistIdMal, anilistMatchMode: details.anilistMatchMode, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${primaryType}/${id}`, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceName, debugInfo });
        } catch (e) {
            const isNotFound = e.response && e.response.status === 404;
            if (!isNotFound) debugInfo.apiErrors.push(`TMDb ID lookup (${primaryType}): ${e.code || e.message}`);
            try {
                await axios.get(`https://api.themoviedb.org/3/${fallbackType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
                const details = await fetchTmdbDetails(id, fallbackType, config, season, episode, groupID, malID, API_TOKEN, cleanTitleForSearch, debugInfo); 
                if (details) return saveCacheAndReturn({ posters: details.posters, postersEnglish: details.postersEnglish, postersJa: details.postersJa, originalLanguage: details.originalLanguage, showTitle: details.showTitle, romajiTitle: details.romajiTitle, anilistTitle: details.anilistTitle, anilistIdMal: details.anilistIdMal, anilistMatchMode: details.anilistMatchMode, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${fallbackType}/${id}`, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceName + ` (Fallback to ${fallbackType.toUpperCase()})`, debugInfo });
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
      const primaryType = isTv ? "tv" : "movie";
      const fallbackType = isTv ? "movie" : "tv";
      debugInfo.searchedTmdb = true; 

      const runCascadeSearch = async (titleToSearch) => {
          const attemptSearch = async (searchType, searchYear) => {
              let url = `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(titleToSearch)}&language=en-US&page=1`;
              if (searchYear) url += searchType === 'movie' ? `&primary_release_year=${searchYear}` : `&first_air_date_year=${searchYear}`;
              if (config.dont === 'nah') url += '&include_adult=true';
              const res = await axios.get(url, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 8000 });
              return res.data.results?.[0];
          };

          let media = await attemptSearch(primaryType, year);
          let usedType = primaryType;

          if (!media && year) {
              media = await attemptSearch(primaryType, null);
              if (media) debugInfo.apiErrors.push(`Strict year match failed. Used title-only match for "${titleToSearch}".`);
          }

          if (!media) {
              usedType = fallbackType;
              media = await attemptSearch(fallbackType, year);
          }

          if (!media && year) {
              usedType = fallbackType;
              media = await attemptSearch(fallbackType, null);
              if (media) debugInfo.apiErrors.push(`Strict year match failed. Used title-only match for "${titleToSearch}".`);
          }

          return { media, usedType };
      };

      try {
          let { media, usedType } = await runCascadeSearch(cleanTitleForSearch);
          let currentTitle = cleanTitleForSearch;

          if (!media) {
              let strippedTitle = currentTitle
                  .replace(/\b(?:S|Season|Part|Cour)\s*\d+\b/ig, '')
                  .replace(/[\(\)\[\]]/g, ' ') 
                  .replace(/\s{2,}/g, ' ')
                  .trim();
              
              if (strippedTitle && strippedTitle !== currentTitle) {
                  debugInfo.apiErrors.push(`No results for "${currentTitle}". Retrying without season indicator -> "${strippedTitle}".`);
                  const retryResult = await runCascadeSearch(strippedTitle);
                  media = retryResult.media;
                  usedType = retryResult.usedType;
                  currentTitle = strippedTitle; 
              }
          }

          if (!media) {
              let noTrailingNumber = currentTitle
                  .replace(/\s+(?:\d{1,3}|[IVX]+)$/ig, '') 
                  .trim();
              
              if (noTrailingNumber && noTrailingNumber !== currentTitle) {
                  debugInfo.apiErrors.push(`No results for "${currentTitle}". Retrying without trailing number -> "${noTrailingNumber}".`);
                  const retryResult = await runCascadeSearch(noTrailingNumber);
                  media = retryResult.media;
                  usedType = retryResult.usedType;
              }
          }

          if (media) {
            const details = await fetchTmdbDetails(media.id, usedType, config, season, episode, groupID, malID, API_TOKEN, cleanTitleForSearch, debugInfo);
            if (details) {
                const sourceMsg = `TMDb (AutoPoster - ${usedType.toUpperCase()})`;
                return saveCacheAndReturn({ posters: details.posters, postersEnglish: details.postersEnglish, postersJa: details.postersJa, originalLanguage: details.originalLanguage, showTitle: details.showTitle, romajiTitle: details.romajiTitle, anilistTitle: details.anilistTitle, anilistIdMal: details.anilistIdMal, anilistMatchMode: details.anilistMatchMode, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${usedType}/${media.id}`, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceMsg, debugInfo });
            }
          }
      } catch(err) {
          debugInfo.apiErrors.push(`TMDb filename search: ${err.code || err.message}`);
      }
    }

    return saveCacheAndReturn({ posters: [], postersEnglish: [], postersJa: [], originalLanguage: null, showTitle: null, romajiTitle: null, anilistTitle: null, fetchedEpisodes: null, mediaUrl: null, titleSourceDebug: 'none', retry: false, source: 'Not Found', debugInfo });
  } catch (err) {
      debugInfo.apiErrors.push(`Unexpected: ${err.code || err.message}`);
      return { posters: [], showTitle: null, romajiTitle: null, anilistTitle: null, fetchedEpisodes: null, mediaUrl: null, titleSourceDebug: 'none', retry: true, source: 'Error', debugInfo };
  }
};

module.exports = { fetchMetadata, fetchTitles, fetchIdsFromTxt };
