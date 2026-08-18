// metadata.js
// File ini menangani SEMUA pengambilan metadata media:
// - Bagian 1: baca ID (tmdb.txt/group.txt) dan judul episode lokal (titles.txt) dari folder video
// - Bagian 2: fetch poster, judul show, dan judul episode dari TMDb
// (sebelumnya terpisah jadi titles.js + poster.js, sekarang digabung karena isinya sama-sama "metadata")
//
// DIPERBAIKI: Semua integrasi Jikan/MyAnimeList (termasuk antrian retry
// background yang pernah ditambahkan) sudah DIHAPUS TOTAL. Jikan API
// terbukti tidak reliable (sering 504 "failed to connect to MyAnimeList",
// bahkan lookup by-ID langsung pun sering gagal) sehingga tidak worth
// dipertahankan. TMDb sekarang menjadi SATU-SATUNYA sumber metadata,
// termasuk untuk anime.

const axios = require("axios");
const fs = require('fs');
const path = require('path');
const { parseSeasonEpisode, _baseHash } = require('./utils');

const tmdbBaseImageUrl = "https://image.tmdb.org/t/p/w500";

// =====================================================================
// BAGIAN 1: FILE TXT LOKAL DI FOLDER VIDEO
// (tmdb.txt, group.txt, titles.txt / titles_sX.txt)
// =====================================================================

// Regex untuk menebak nomor episode dari nama file, juga mengenali "Book" dan "Part" layaknya "Season"
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

// DIPERBAIKI: malID dihapus. Hanya membaca tmdb.txt dan group.txt sekarang.
const fetchIdsFromTxt = (videoDir) => {
    let tmdbID = null, groupID = null;
    try {
        const tmdbFilePath = path.join(videoDir, 'tmdb.txt');
        const groupFilePath = path.join(videoDir, 'group.txt'); // File untuk Episode Group

        if (fs.existsSync(tmdbFilePath)) {
            const tmdbContent = fs.readFileSync(tmdbFilePath, 'utf-8').trim();
            // Validasi: ID TMDb berupa angka, BUKAN diawali 'tt'
            if (tmdbContent && !isNaN(tmdbContent)) tmdbID = tmdbContent;
        }
        if (fs.existsSync(groupFilePath)) {
            const groupContent = fs.readFileSync(groupFilePath, 'utf-8').trim();
            // Validasi ID Group: Berupa string alfanumerik panjang (contoh: 69afde88e6719c2c9add36ce)
            if (groupContent) groupID = groupContent;
        }
        return { tmdbID, groupID };
    } catch (err) {
        return { tmdbID: null, groupID: null };
    }
};

// Ambil judul episode dari titles.txt / titles_sX.txt lokal (BUKAN dari TMDb API).
// Format di sini SELALU ikut konvensi _sX filenya (tidak diubah oleh aturan "auto" di bawah).
const fetchTitles = async (filename, filePath) => {
    const { filenameParse } = await import('@ctrl/video-filename-parser');
    const videoDir = filePath ? path.dirname(filePath) : '.';
    const { titles, titlesFile } = loadTitles(videoDir);
    let episode = null;
    let forcedSeason = null; // Menangkap angka season dari file txt

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

// =====================================================================
// BAGIAN 2: FETCH DARI TMDb (poster, judul show, judul episode)
// =====================================================================

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
        let tagline = data.tagline && data.tagline.trim() !== "" ? data.tagline.trim() : null;
        let mainReleaseDate = data.release_date || data.first_air_date || null;
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

        return { posters: finalPosters, showTitle: standardTitle, romajiTitle: romajiTitle, fetchedEpisodes, tagline, mainReleaseDate };
    } catch (err) { return null; }
};

// DIPERBAIKI: parameter malID dihapus dari signature (dulu: tmdbID, malID, groupID, ...)
const fetchMetadata = async (tmdbID, groupID, actualFilePath, cleanedName) => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    const API_TOKEN = getTmdbToken(config);

    const rawTitle = cleanedName.replace(/\.+[a-zA-Z0-9]+$/, "");
    const fileBasename = actualFilePath ? path.basename(actualFilePath) : cleanedName;
    const folderPath = actualFilePath ? path.dirname(actualFilePath) : __dirname;

    const isTv = /(?:Season|Book|Part|S\d+E\d+|Episode\s*\d+|Ep\s*\d+|E\d{1,4}|\s-\s*\d{1,4})/i.test(rawTitle);
    const { season: parsedSeason, episode } = parseSeasonEpisode(rawTitle);
    let season = parsedSeason;

    // BARU: Override angka Season menggunakan titles_sX.txt jika filenya ada di folder!
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
    .replace(/[\._\-\(\)\[\]]/g, ' ') // Tambahan \(\)\[\] agar sisa kurung dari tahun ikut terhapus
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
    // DIPERBAIKI: malID/config.mal_id dihapus dari daftar fallback cacheKey.
    const currentConfigState = `${config.dont}-GRP:${!!groupID}`;
    const cacheKey = tmdbID || config.tmdb_id || cleanTitleForSearch;
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
                tmdbReleaseDate: epData ? epData.tmdbReleaseDate : (seriesData.mainReleaseDate || null),
                tmdbTagline: seriesData.tagline || null,
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
                    romajiTitle: result.romajiTitle,
                    tagline: result.tagline || null,
                    mainReleaseDate: formatApiDate(result.mainReleaseDate) || null,
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
            result.tmdbReleaseDate = currentEpData ? currentEpData.tmdbReleaseDate : cacheData[cacheKey].mainReleaseDate;
            result.tmdbTagline = cacheData[cacheKey].tagline;

            try { fs.writeFileSync(targetCachePath, JSON.stringify(cacheData, null, 4)); } catch (err) {}
        }
        return result;
    };
    // =====================================================================

    try {
        // DIPERBAIKI: Seluruh blok lookup Jikan (immediate try + antrian retry
        // background) DIHAPUS TOTAL di sini. Alur sekarang langsung ke TMDb ID
        // (tmdb.txt / config.json), lalu fallback ke pencarian filename TMDb.

        const checkTmdbId = async (id, sourceName, isTvCheck) => {
            const primaryType = isTvCheck ? 'tv' : 'movie';
            const fallbackType = isTvCheck ? 'movie' : 'tv';
            try {
                await axios.get(`https://api.themoviedb.org/3/${primaryType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
                const details = await fetchTmdbDetails(id, primaryType, config, season, episode, groupID, API_TOKEN);
                if (details) return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${primaryType}/${id}`, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceName, debugInfo });
            } catch (e) {
                const isNotFound = e.response && e.response.status === 404;
                if (!isNotFound) debugInfo.apiErrors.push(`TMDb ID lookup (${primaryType}): ${e.code || e.message}`);
                try {
                    await axios.get(`https://api.themoviedb.org/3/${fallbackType}/${id}`, { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 5000 });
                    const details = await fetchTmdbDetails(id, fallbackType, config, season, episode, groupID, API_TOKEN);
                    if (details) return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${fallbackType}/${id}`, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceName + ` (Fallback to ${fallbackType.toUpperCase()})`, debugInfo });
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

            // Fungsi Helper (Mesin Kaskade: Mencari kombinasi Tahun & Tipe)
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
                // TAHAP 1: Cari dengan judul penuh (Membiarkan teks Sx / S2 / Angka tetap utuh)
                let { media, usedType } = await runCascadeSearch(cleanTitleForSearch);
                let currentTitle = cleanTitleForSearch;

                // TAHAP 2: Jika GAGAL, coba pangkas indikator Season eksplisit (S1, S2, Season 3, Part 2, dll)
                if (!media) {
                    let strippedTitle = currentTitle
                    .replace(/\b(?:S|Season|Part|Cour)\s*\d+\b/ig, '') // Menghapus kata "S2", "Season 2", "Part 2"
                    .replace(/[\(\)\[\]]/g, ' ') // Bersihkan sisa kurung (jika ada)
                    .replace(/\s{2,}/g, ' ')
                    .trim();

                    if (strippedTitle && strippedTitle !== currentTitle) {
                        debugInfo.apiErrors.push(`No results for "${currentTitle}". Retrying without season indicator -> "${strippedTitle}".`);
                        const retryResult = await runCascadeSearch(strippedTitle);
                        media = retryResult.media;
                        usedType = retryResult.usedType;
                        currentTitle = strippedTitle; // Simpan judul yang sudah bersih untuk tahap selanjutnya
                    }
                }

                // TAHAP 3: Jika MASIH GAGAL, pangkas angka / angka romawi yang berdiri sendiri di AKHIR judul
                // Contoh: "Tetsuwan Birdy Decode 2" -> "Tetsuwan Birdy Decode"
                // Contoh: "Sword Art Online II" -> "Sword Art Online"
                if (!media) {
                    let noTrailingNumber = currentTitle
                    .replace(/\s+(?:\d{1,3}|[IVX]+)$/ig, '') // Hapus spasi + angka(1-999) atau Romawi (I, II, IV, X) di akhir string
                    .trim();

                    if (noTrailingNumber && noTrailingNumber !== currentTitle) {
                        debugInfo.apiErrors.push(`No results for "${currentTitle}". Retrying without trailing number -> "${noTrailingNumber}".`);
                        const retryResult = await runCascadeSearch(noTrailingNumber);
                        media = retryResult.media;
                        usedType = retryResult.usedType;
                    }
                }

                if (media) {
                    const details = await fetchTmdbDetails(media.id, usedType, config, season, episode, groupID, API_TOKEN);
                    if (details) {
                        const sourceMsg = `TMDb (AutoPoster - ${usedType.toUpperCase()})`;
                        return saveCacheAndReturn({ posters: details.posters, showTitle: details.showTitle, romajiTitle: details.romajiTitle, fetchedEpisodes: details.fetchedEpisodes, tmdbUrl: `https://www.themoviedb.org/${usedType}/${media.id}`, tagline: details.tagline, mainReleaseDate: details.mainReleaseDate, retry: false, source: sourceMsg, debugInfo });
                    }
                }
            } catch(err) {
                // Pencarian filename gagal total (network down, rate limit, dll) -> catat agar logger tahu
                debugInfo.apiErrors.push(`TMDb filename search: ${err.code || err.message}`);
            }
        }

        return saveCacheAndReturn({ posters: [], showTitle: null, romajiTitle: null, fetchedEpisodes: null, tmdbUrl: null, retry: false, source: 'Not Found', debugInfo });
    } catch (err) {
        // Error tak terduga di luar semua try/catch internal (mis. TMDb down, config.json rusak)
        debugInfo.apiErrors.push(`Unexpected: ${err.code || err.message}`);
        return { posters: [], showTitle: null, romajiTitle: null, fetchedEpisodes: null, tmdbUrl: null, retry: true, source: 'Error', debugInfo };
    }
};

module.exports = { fetchMetadata, fetchTitles, fetchIdsFromTxt };
