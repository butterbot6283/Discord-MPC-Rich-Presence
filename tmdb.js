// tmdb.js
// Modul ini menangani seluruh komunikasi API TMDb dan AniList.
const axios = require("axios");
const { _baseHash } = require('./utils');

const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/w500";

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

const getTmdbToken = (config) => {
    if (config.personal_tmdb_token && config.personal_tmdb_token.trim() !== "") return config.personal_tmdb_token.trim();
    return Buffer.from(_baseHash.split('').reverse().join(''), 'base64').toString('utf-8');
};

const formatApiDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const month = parseInt(parts[1], 10), day = parseInt(parts[2], 10);
    if (isNaN(month) || isNaN(day)) return dateStr;
    return `${months[month - 1]} ${day}, ${parts[0]}`;
};

// Perubahan: helper request terpusat agar metadata hanya mengatur alur data.
const tmdbGet = (url, options) => axios.get(url, options);

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

module.exports = { getTmdbToken, formatApiDate, cleanTitleForAnilist, fetchAnilistTitleByMalId, fetchAnilistTitle, fetchTmdbDetails, tmdbGet };
