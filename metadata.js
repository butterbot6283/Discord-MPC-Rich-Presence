// metadata.js
const fs = require('fs');
const path = require('path');
const { parseSeasonEpisode } = require('./utils');
const {
    getTmdbToken,
    formatApiDate,
    fetchAnilistTitleByMalId,
    fetchAnilistTitle,
    fetchTmdbDetails,
    cleanTitleForAnilist,
    tmdbGet
} = require('./tmdb');

const POSTER_CACHE_VERSION = 2;

const extractTmdbIdFromUrl = (tmdbUrl) => {
    const match = typeof tmdbUrl === 'string' && tmdbUrl.match(/\/(?:tv|movie)\/(\d+)/i);
    return match ? match[1] : null;
};

// Prefer IDs explicitly recorded by this version, but recover the TMDb ID
// from tmdbUrl for older cache entries so they can be migrated to the same
// canonical layout on their next use.
const fetchCachedIds = (videoDir, cleanedName) => {
    if (!videoDir || !cleanedName) return { tmdbID: null, groupID: null, malID: null };

    try {
        const rawTitle = cleanedName.replace(/\.+[a-zA-Z0-9]+$/, '');
        let cleanTitle = rawTitle.replace(/\[.*?\]/g, '');
        const yearMatch = cleanTitle.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) cleanTitle = cleanTitle.substring(0, yearMatch.index).trim();
        cleanTitle = cleanTitle
            .replace(/[_\-\s]+(?:S\d+E\d+|Season|Book|Part|Episode|Ep|E)\s*\d+.*/i, '')
            .replace(/[_\-\s]*[_\-]+[_\-\d\s]+$/, '')
            .replace(/S\d+E\d+.*/i, '')
            .replace(/(?:Season|Book|Part|Episode|Ep)\s*\d+.*/i, '')
            .replace(/\bE\d{1,4}\b.*/i, '')
            .replace(/\b(BD|DVD|HD|Dub Indonesia|Dubbed|Dub|Sub|Raw|OVA|ONA|NC|Creditless)\b/gi, '')
            .replace(/[\._\-\(\)\[\]]/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        const folderCache = path.join(videoDir, 'rpc_cache.json');
        const fallbackCache = path.join(__dirname, 'rpc_cache.json');
        // Reading a folder cache must not depend on write permission. This is
        // important for mounted/removable drives where an existing cache is
        // readable even though Node reports the directory as non-writable.
        const cachePath = fs.existsSync(folderCache) ? folderCache : fallbackCache;
        if (!fs.existsSync(cachePath)) return { tmdbID: null, groupID: null, malID: null };

        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const entry = Object.values(cacheData).find(item =>
            item && item.debugInfo?.cleanTitle === cleanTitle &&
            (item.idtmdb || extractTmdbIdFromUrl(item.tmdbUrl))
        );
        if (!entry) return { tmdbID: null, groupID: null, malID: null };

        return {
            tmdbID: entry.idtmdb || extractTmdbIdFromUrl(entry.tmdbUrl),
            groupID: entry.group || null,
            malID: entry.idmal || null
        };
    } catch (_) {
        return { tmdbID: null, groupID: null, malID: null };
    }
};

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
        const matchSeason = titlesFile.match(/^titles_s(\d+)\.txt$/i);
        if (matchSeason) forcedSeason = parseInt(matchSeason[1], 10);
    }

    const info = filenameParse(filename, true);
    if (info.episodeNumbers && info.episodeNumbers.length > 0) {
        episode = parseInt(info.episodeNumbers[0], 10);
    } else {
        const match = filename.match(EPISODE_PATTERN);
        if (match) episode = parseInt(match[1], 10);
    }

    let localEpisode = null;
    if (episode !== null && !Number.isNaN(episode) && titles.length > 0) {
        localEpisode = titles.find(item => item.episode_number === episode) || null;
    }

    let formattedEpisodeTitle = null;
    if (localEpisode) {
		const episodeNum = localEpisode.episode_number.toString();
		
        if (/^titles_s\d+\.txt$/i.test(titlesFile || '')) {
			const seasonNum = forcedSeason.toString().padStart(2, '0');
			const paddedEpisodeNum = episodeNum.padStart(2, '0');
            formattedEpisodeTitle = `S${seasonNum}E${paddedEpisodeNum}: ${localEpisode.title}`;
        } else {
            formattedEpisodeTitle = `Episode ${episodeNum}: ${localEpisode.title}`;
        }
    }

    return {
        episodeTitle: formattedEpisodeTitle,
        releaseDate: localEpisode ? localEpisode.release_date : null,
        forcedSeason,
        debugInfo: {
            parsedEpisode: Number.isNaN(episode) ? null : episode,
            titlesFile,
            loadedCount: titles.length,
            localEpisodeMatched: Boolean(localEpisode)
        }
    };
};

const fetchMetadata = async (tmdbID, groupID, malID, actualFilePath, cleanedName) => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    const API_TOKEN = getTmdbToken(config);

    const rawTitle = cleanedName.replace(/\.+[a-zA-Z0-9]+$/, "");
    const fileBasename = actualFilePath ? path.basename(actualFilePath) : cleanedName;
    const folderPath = actualFilePath ? path.dirname(actualFilePath) : __dirname;

    const filenameLooksLikeTv = /(?:Season|Book|Part|S\d+E\d+|Episode\s*\d+|Ep\s*\d+|E\d{1,4}|\s-\s*\d{1,4})/i.test(rawTitle);
    const { season: parsedSeason, episode } = parseSeasonEpisode(rawTitle);
    let season = parsedSeason;

    const { titlesFile } = loadTitles(folderPath);
    const forcedTvBySeasonFile = Boolean(
        titlesFile && /^titles_s\d+\.txt$/i.test(titlesFile)
    );

    if (titlesFile) {
        const matchSeason = titlesFile.match(/^titles_s(\d+)\.txt$/);
        if (matchSeason) season = parseInt(matchSeason[1], 10);
    }

    const isTv = forcedTvBySeasonFile || filenameLooksLikeTv;

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

    let debugInfo = {
        cleanTitle: cleanTitleForSearch,
        year: year,
        searchedTmdb: false,
        forcedTvBySeasonFile,
            titlesFile: titlesFile || null,
            forcedTvBySeasonFile,
            forcedSeason: season,
            parsedSeason,
            parsedEpisode: episode,
            apiErrors: []
    };

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

    const currentConfigState = `${config.dont}-GRP:${!!groupID}-TVFILE:${forcedTvBySeasonFile}`;
    // The human-readable clean title is the persistent cache key. idtmdb is
    // stored inside the entry and remains the authoritative metadata ID.
    let cacheKey = cleanTitleForSearch;
    const targetSeason = season !== null ? season : 1;
    const epKey = groupID ? `GROUP_S${targetSeason}E${episode}` : `S${targetSeason}E${episode}`;

    // Migrate the short-lived numeric-key layout back to the readable title
    // key. Keep data only when both entries point to the same TMDb result.
    const legacyIdKey = Object.keys(cacheData).find(key => {
        const entry = cacheData[key];
        return key !== cacheKey && entry &&
            entry.debugInfo?.cleanTitle === cleanTitleForSearch;
    });
    if (legacyIdKey) {
        const legacy = cacheData[legacyIdKey];
        const legacyTmdbId = legacy.idtmdb || extractTmdbIdFromUrl(legacy.tmdbUrl);
        const current = cacheData[cacheKey];
        const currentTmdbId = current?.idtmdb || extractTmdbIdFromUrl(current?.tmdbUrl);
        if (!current) {
            cacheData[cacheKey] = legacy;
        } else if (String(legacyTmdbId || '') === String(currentTmdbId || '')) {
            current.episodes = { ...(legacy.episodes || {}), ...(current.episodes || {}) };
            current.seasonTitles = { ...(legacy.seasonTitles || {}), ...(current.seasonTitles || {}) };
            if (!current.idmal && legacy.idmal) current.idmal = legacy.idmal;
            if (!current.group && legacy.group) current.group = legacy.group;
        }
        delete cacheData[legacyIdKey];
        try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (_) {}
    }

    const ensureCachedIdFields = (seriesData, seasonNum) => {
        if (!seriesData) return false;
        let changed = false;
        if (!Object.hasOwn(seriesData, 'idtmdb')) {
            seriesData.idtmdb = extractTmdbIdFromUrl(seriesData.tmdbUrl);
            changed = true;
        }
        if (!Object.hasOwn(seriesData, 'idmal')) {
            seriesData.idmal = seriesData.seasonTitles?.[seasonNum]?.idMal || null;
            changed = true;
        }
        if (!Object.hasOwn(seriesData, 'group')) {
            // Old cache files did not record whether their group request worked.
            seriesData.group = null;
            changed = true;
        }
        return changed;
    };

    // titles_sX.txt has two roles:
    // 1) force TV + the season number from its filename;
    // 2) when it contains a valid matching row, use that row as the local
    //    episode title/date. An existing-but-empty file falls back to TMDb.
    let localEpisodeTitle = null;
    let localEpisodeReleaseDate = null;
    let localEpisodeMatched = false;
    try {
        const titleResult = await fetchTitles(fileBasename, actualFilePath);
        localEpisodeTitle = titleResult.episodeTitle || null;
        localEpisodeReleaseDate = titleResult.releaseDate || null;
        localEpisodeMatched = Boolean(titleResult.debugInfo?.localEpisodeMatched);
        if (titleResult.debugInfo) {
            debugInfo.titlesFile = titleResult.debugInfo.titlesFile || null;
            debugInfo.loadedTitleCount = titleResult.debugInfo.loadedCount || 0;
            debugInfo.localEpisodeMatched = localEpisodeMatched;
        }
    } catch (e) {}

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

    const resolveCachedEpisode = (seriesData) => {
        if (!seriesData || !seriesData.episodes || episode === null || episode === undefined || Number.isNaN(episode)) return null;

        const episodes = seriesData.episodes;
        const canonicalKey = epKey;
        const legacyKey = fileBasename;

        // Prefer the stable season/episode key. Older versions stored the
        // episode data under the filename, so keep that as a compatibility fallback.
        if (episodes[canonicalKey]) return episodes[canonicalKey];
        if (episodes[legacyKey]) return episodes[legacyKey];
        return null;
    };

    const migrateEpisodeKeyToCanonical = (seriesData, epData) => {
        if (!seriesData || !seriesData.episodes || !epData || !epKey) return;
        if (!seriesData.episodes[epKey]) {
            seriesData.episodes[epKey] = epData;
        }
        if (fileBasename !== epKey && seriesData.episodes[fileBasename]) {
            delete seriesData.episodes[fileBasename];
        }
    };

    const cachedTmdbId = cacheData[cacheKey]?.idtmdb || extractTmdbIdFromUrl(cacheData[cacheKey]?.tmdbUrl);
    const cacheMatchesRequestedTmdbId = !tmdbID || String(cachedTmdbId || '') === String(tmdbID);
    if (cacheData[cacheKey] && cacheMatchesRequestedTmdbId && cacheData[cacheKey].configState === currentConfigState && cacheData[cacheKey].posterCacheVersion === POSTER_CACHE_VERSION) {
        const seriesData = cacheData[cacheKey];
        let cacheIdsChanged = ensureCachedIdFields(seriesData, targetSeason);

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
                seriesData.idmal = malResult.idMal || null;
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
                seriesData.idmal = idMal || null;

                try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (e) {}
            }
        }

        let epData = resolveCachedEpisode(seriesData);
        if (epData) {
            migrateEpisodeKeyToCanonical(seriesData, epData);
            cacheIdsChanged = true;
        }
        if (cacheIdsChanged) {
            try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (e) {}
        }

        const resolved = resolveTitleAndUrl(seriesData, targetSeason);
        let finalShowTitle = resolved.title;
        let finalMediaUrl = resolved.url;
        if (!config.autoPoster) finalShowTitle = null;

        // A TV cache entry is only a complete hit when its episode metadata is
        // also available. Otherwise continue into the normal TMDb resolver so the
        // season can be fetched and the missing episode entry can be hydrated.
        if (!isTv || epData) {
            return {
                posters: selectCachedPosters(seriesData, config),
                showTitle: finalShowTitle,
                mediaUrl: finalMediaUrl,
				mediaType: seriesData.tmdbUrl ? (seriesData.tmdbUrl.includes('/tv/') ? 'tv' : 'movie') : null,
                titleSourceDebug: resolved.sourceDebug,
                anilistMatchMode: seasonOverride?.source === 'mal.txt' ? 'mal.txt' : (seasonOverride?.source === 'anilist' ? (seasonOverride.matchMode || 'date-exact') : null),
                tmdbEpisodeTitle: localEpisodeMatched ? localEpisodeTitle : (epData ? epData.tmdbEpisodeTitle : null),
                tmdbReleaseDate: localEpisodeMatched ? localEpisodeReleaseDate : (epData ? epData.tmdbReleaseDate : (seriesData.mainReleaseDate || null)),
                tmdbTagline: seriesData.tagline || null,
                source: `[CACHE] ` + (epData ? epData.source : seriesData.source || 'TMDb'),
                retry: false, debugInfo: seriesData.debugInfo
            };
        }
    }

    const saveCacheAndReturn = (result) => {
        if (!result.retry) {
            const resolvedTmdbId = result.idtmdb || extractTmdbIdFromUrl(result.tmdbUrl);
            if (resolvedTmdbId) {
                const titleKey = cleanTitleForSearch;

                // Remove old numeric entries for this title. Compatible data
                // can be retained; a different ID is intentionally discarded.
                for (const key of Object.keys(cacheData)) {
                    if (key === titleKey) continue;
                    const entry = cacheData[key];
                    if (!entry || entry.debugInfo?.cleanTitle !== cleanTitleForSearch) continue;

                    const entryTmdbId = entry.idtmdb || extractTmdbIdFromUrl(entry.tmdbUrl);
                    if (String(entryTmdbId || '') === String(resolvedTmdbId)) {
                        if (!cacheData[titleKey]) {
                            cacheData[titleKey] = entry;
                        } else {
                            const titleEntry = cacheData[titleKey];
                            titleEntry.episodes = { ...(entry.episodes || {}), ...(titleEntry.episodes || {}) };
                            titleEntry.seasonTitles = { ...(entry.seasonTitles || {}), ...(titleEntry.seasonTitles || {}) };
                            if (!titleEntry.idmal && entry.idmal) titleEntry.idmal = entry.idmal;
                            if (!titleEntry.group && entry.group) titleEntry.group = entry.group;
                        }
                    }
                    delete cacheData[key];
                }

                // A new TMDb ID means all result-dependent fields (poster,
                // episodes, URLs, and titles) must be rebuilt from that ID.
                const existingId = cacheData[titleKey]?.idtmdb || extractTmdbIdFromUrl(cacheData[titleKey]?.tmdbUrl);
                if (existingId && String(existingId) !== String(resolvedTmdbId)) {
                    delete cacheData[titleKey];
                }
                cacheKey = titleKey;
            }

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
                    idtmdb: result.idtmdb || extractTmdbIdFromUrl(result.tmdbUrl),
                    idmal: result.idmal || null,
                    group: result.group || null,
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

            // Record the IDs that resolved successfully for this cache entry.
            // A failed or unused resolver is represented explicitly as null.
            cacheData[cacheKey].idtmdb = result.idtmdb || extractTmdbIdFromUrl(result.tmdbUrl) || null;
            cacheData[cacheKey].idmal = result.idmal || null;
            cacheData[cacheKey].group = result.group || null;

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
            } else if (cacheData[cacheKey].episodes[fileBasename]) {
                // Migrate legacy filename-keyed episode data to the stable key.
                currentEpData = cacheData[cacheKey].episodes[fileBasename];
                cacheData[cacheKey].episodes[epKey] = currentEpData;
                if (fileBasename !== epKey) delete cacheData[cacheKey].episodes[fileBasename];
            }

            const resolved = resolveTitleAndUrl(cacheData[cacheKey], targetSeason);
            result.showTitle = resolved.title;
            result.mediaUrl = resolved.url;
            result.titleSourceDebug = resolved.sourceDebug;
            result.posters = selectCachedPosters(cacheData[cacheKey], config);
			
			if (cacheData[cacheKey].tmdbUrl) {
                result.mediaType = cacheData[cacheKey].tmdbUrl.includes('/tv/') ? 'tv' : 'movie';
            } else {
                result.mediaType = null;
            }

            if (!config.autoPoster) result.showTitle = null;

            result.tmdbEpisodeTitle = localEpisodeMatched ? localEpisodeTitle : (currentEpData ? currentEpData.tmdbEpisodeTitle : null);
            result.tmdbReleaseDate = localEpisodeMatched ? localEpisodeReleaseDate : (currentEpData ? currentEpData.tmdbReleaseDate : cacheData[cacheKey].mainReleaseDate);
            result.tmdbTagline = cacheData[cacheKey].tagline;

            try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (err) {}
        }
        return result;
    };

    try {
        const checkTmdbId = async (id, sourceName, isTvCheck) => {
            const primaryType = forcedTvBySeasonFile ? 'tv' : (isTvCheck ? 'tv' : 'movie');
            const fallbackType = forcedTvBySeasonFile ? null : (isTvCheck ? 'movie' : 'tv');
            try {
                await tmdbGet(`https://api.themoviedb.org/3/${primaryType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
                const details = await fetchTmdbDetails(id, primaryType, config, season, episode, groupID, malID, API_TOKEN, cleanTitleForSearch, debugInfo);
                if (details) return saveCacheAndReturn({ posters: details.posters, postersEnglish: details.postersEnglish, postersJa: details.postersJa, originalLanguage: details.originalLanguage, showTitle: details.showTitle, romajiTitle: details.romajiTitle, anilistTitle: details.anilistTitle, anilistIdMal: details.anilistIdMal, anilistMatchMode: details.anilistMatchMode, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${primaryType}/${id}`, idtmdb: id, idmal: details.anilistIdMal, group: details.usedGroupID, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceName, debugInfo });
            } catch (e) {
                const isNotFound = e.response && e.response.status === 404;
                if (!isNotFound) debugInfo.apiErrors.push(`TMDb ID lookup (${primaryType}): ${e.code || e.message}`);
                if (fallbackType) {
                    try {
                        await tmdbGet(`https://api.themoviedb.org/3/${fallbackType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
                        const details = await fetchTmdbDetails(id, fallbackType, config, season, episode, groupID, malID, API_TOKEN, cleanTitleForSearch, debugInfo);
                        if (details) return saveCacheAndReturn({ posters: details.posters, postersEnglish: details.postersEnglish, postersJa: details.postersJa, originalLanguage: details.originalLanguage, showTitle: details.showTitle, romajiTitle: details.romajiTitle, anilistTitle: details.anilistTitle, anilistIdMal: details.anilistIdMal, anilistMatchMode: details.anilistMatchMode, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${fallbackType}/${id}`, idtmdb: id, idmal: details.anilistIdMal, group: details.usedGroupID, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceName + ` (Fallback to ${fallbackType.toUpperCase()})`, debugInfo });
                    } catch (err) {
                        const fallbackNotFound = err.response && err.response.status === 404;
                        if (!fallbackNotFound) debugInfo.apiErrors.push(`TMDb ID lookup (${fallbackType}): ${err.code || err.message}`);
                    }
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
            const primaryType = forcedTvBySeasonFile ? "tv" : (isTv ? "tv" : "movie");
            const fallbackType = forcedTvBySeasonFile ? null : (isTv ? "movie" : "tv");
            debugInfo.searchedTmdb = true;

            const runCascadeSearch = async (titleToSearch) => {
                const attemptSearch = async (searchType, searchYear) => {
                    let url = `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(titleToSearch)}&language=en-US&page=1`;
                    if (searchYear) url += searchType === 'movie' ? `&primary_release_year=${searchYear}` : `&first_air_date_year=${searchYear}`;
                    if (config.dont === 'nah') url += '&include_adult=true';
                    const res = await tmdbGet(url, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 8000 });
                    return res.data.results?.[0];
                };

                let media = await attemptSearch(primaryType, year);
                let usedType = primaryType;

                if (!media && year) {
                    media = await attemptSearch(primaryType, null);
                    if (media) debugInfo.apiErrors.push(`Strict year match failed. Used title-only match for "${titleToSearch}".`);
                }

                if (!media && fallbackType) {
                    usedType = fallbackType;
                    media = await attemptSearch(fallbackType, year);
                }

                if (!media && year && fallbackType) {
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
                        const sourceMsg = forcedTvBySeasonFile ? `TMDb (AutoPoster - TV via titles_sX.txt)` : `TMDb (AutoPoster - ${usedType.toUpperCase()})`;
                        return saveCacheAndReturn({ posters: details.posters, postersEnglish: details.postersEnglish, postersJa: details.postersJa, originalLanguage: details.originalLanguage, showTitle: details.showTitle, romajiTitle: details.romajiTitle, anilistTitle: details.anilistTitle, anilistIdMal: details.anilistIdMal, anilistMatchMode: details.anilistMatchMode, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${usedType}/${media.id}`, idtmdb: media.id, idmal: details.anilistIdMal, group: details.usedGroupID, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceMsg, debugInfo });
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

module.exports = { fetchMetadata, fetchTitles, fetchIdsFromTxt, fetchCachedIds };
