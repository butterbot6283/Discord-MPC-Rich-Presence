const fs = require('fs');
const path = require('path');
const mpc = require('./mpc');
const { buildPayload } = require('./payload');
const logger = require('./logger');
const { fetchMetadata, fetchTitles } = require('./metadata');
const utils = require('./utils');

const configPath = path.join(__dirname, 'config.json');
let config = {};

const loadConfig = () => {
    try {
        if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {}
    return config;
};
config = loadConfig();

let lastPlaybackState = 'offline';
let lastMpcStatus = null;

// Cache Terpadu API & Gambar
let cachedPosters = [], currentPosterIndex = 0, lastSlideshowTick = 0;
let currentCustomImageIndex = 0;
let cachedShowTitle = null, cachedApiEpisodeTitle = null, cachedPosterSource = null, cachedTmdbUrl = null, cachedTmdbReleaseDate = null, cachedPosterDebug = null, cachedTmdbTagline = null;
// DIPERBAIKI: lastMalId & lastConfigMalId dihapus (Jikan/MAL sudah tidak dipakai)
let lastFetchedFileName = null, lastTmdbId = null, lastConfigTmdbId = null, lastAutoTrigger = null;
let lastFetchedTitlesFileName = null, cachedFetchedTitles = null;

let currentWatchedFolder = null;
let txtWatcher = null;

const resetAllCaches = () => {
    mpc.resetMpcCache();
    cachedFetchedTitles = null; lastFetchedTitlesFileName = null;
    cachedPosters = []; currentPosterIndex = 0; currentCustomImageIndex = 0;
    cachedShowTitle = null; cachedApiEpisodeTitle = null; cachedPosterSource = null; cachedPosterDebug = null; cachedTmdbUrl = null; cachedTmdbReleaseDate = null; cachedTmdbTagline = null;
    lastFetchedFileName = null; lastTmdbId = null;
    lastConfigTmdbId = null; lastAutoTrigger = null;
};

// =================================================================
// LIVE CONFIG WATCHER
// =================================================================
let configTimeout = null;
let updateCallback = null;

fs.watch(configPath, (eventType) => {
    if (eventType === 'change') {
        if (configTimeout) clearTimeout(configTimeout);
        configTimeout = setTimeout(async () => {
            const newConfig = loadConfig();
            const oldConfig = { ...config };
            config = newConfig;

            // DIPERBAIKI: mal_id dihapus dari daftar key yang memicu apiChanged
            const apiChanged = oldConfig.autoPoster !== newConfig.autoPoster ||
            oldConfig.autoEpisode !== newConfig.autoEpisode ||
            oldConfig.autoDate !== newConfig.autoDate ||
            oldConfig.romajiTitle !== newConfig.romajiTitle ||
            oldConfig.dont !== newConfig.dont ||
            oldConfig.tmdb_id !== newConfig.tmdb_id ||
            oldConfig.cleanFilename !== newConfig.cleanFilename;

            const visualChanged = oldConfig.customText !== newConfig.customText ||
            oldConfig.customBigText !== newConfig.customBigText ||
            oldConfig.randomPoster !== newConfig.randomPoster ||
            oldConfig.slideshowInterval !== newConfig.slideshowInterval ||
            JSON.stringify(oldConfig.customImage) !== JSON.stringify(newConfig.customImage);

            if (apiChanged || visualChanged) {
                // Kumpulkan nama key yang berubah agar logger bisa cetak detailnya
                const changedKeys = Object.keys(newConfig).filter(k => JSON.stringify(oldConfig[k]) !== JSON.stringify(newConfig[k]));
                logger.logConfigChanged(changedKeys, apiChanged);
                if (apiChanged) {
                    resetAllCaches();
                }

                if (lastMpcStatus && !lastMpcStatus.isOffline && updateCallback) {
                    await updatePresence(lastMpcStatus, updateCallback);
                }
            }
        }, 500);
    }
});

const setUpdateCallback = (cb) => { updateCallback = cb; };
const getConfig = () => config;

async function handleStatus(status, client) {
    lastMpcStatus = status;

    // Error nyata dan tak terduga (bukan sekadar MPC-HC tertutup) -> lapor sebagai error, bukan offline
    if (status && status.isError) {
        logger.logMpcError(status.errorCode, status.errorMessage);
        lastPlaybackState = 'offline';
        if (client && client.user) client.user.clearActivity().catch(() => {});
        resetAllCaches();
        return;
    }

    if (!status || status.isOffline) {
        logger.logOffline();
        lastPlaybackState = 'offline';
        if (client && client.user) client.user.clearActivity().catch(() => {});
        resetAllCaches();
        return;
    }

    logger.resetOfflineStatus();
    const currentState = status.isPlaying ? 'playing' : (status.isPaused ? 'paused' : 'stopped');
    lastPlaybackState = currentState;

    // DIPERBAIKI: updatePresence sekarang dipanggil di SETIAP tick (setiap 5
    // detik, mengikuti interval yang sama dengan index.js), bukan cuma saat
    // sedang playing atau saat state baru saja berubah.
    //
    // Sebelumnya kondisinya begini:
    //   if (currentState === 'playing' || currentState !== lastPlaybackState)
    // Artinya kalau video di-PAUSE dan state TIDAK berubah dari tick
    // sebelumnya (masih 'paused' terus), updatePresence tidak pernah
    // dipanggil lagi. Akibatnya: slideshow (customImage/poster) berhenti
    // berputar, perubahan config.json (customText, customBigText, dll), dan
    // perubahan file .txt di folder video (tmdb.txt/titles.txt) SEMUA tidak
    // diterapkan ke Discord sampai video di-play lagi.
    //
    // updatePresence() sendiri sudah punya guard internal (needsFetch,
    // isNewMedia) sehingga memanggilnya tiap tick TIDAK menyebabkan fetch API
    // berulang ke TMDb -- ia hanya benar-benar fetch ulang kalau memang ada
    // perubahan file/ID/config. Jadi aman dipanggil terus-menerus.
    await updatePresence(status, async (payload) => {
        if (client && client.user) client.user.setActivity(payload).catch(() => {});
    });
}

async function updatePresence(mpcStatus, setActivity) {
    if (!mpcStatus) return;

    let showTitle = null;
    const isNewMedia = (mpcStatus.rawFileName !== lastFetchedTitlesFileName);
    let fetchedEpisodeTitle = null;
    let fetchedReleaseDate = null;
    let forcedSeason = null;

    // LIVE TXT WATCHER (Memantau file .txt di folder video secara real-time)
    const currentFolder = mpcStatus.filePath ? path.dirname(mpcStatus.filePath) : null;
    if (currentFolder && currentFolder !== currentWatchedFolder) {
        if (txtWatcher) txtWatcher.close();
        currentWatchedFolder = currentFolder;
        try {
            txtWatcher = fs.watch(currentFolder, (eventType, filename) => {
                if (filename && filename.match(/^(tmdb|titles|group)\.txt$/i)) {
                    logger.logTxtWatcherEvent(filename);
                    lastFetchedFileName = null;
                    lastFetchedTitlesFileName = null;
                    resetAllCaches();
                }
            });
        } catch(e) {}
    }

    if (isNewMedia) {
        const titles = await fetchTitles(mpcStatus.fileName, mpcStatus.filePath || null);
        cachedFetchedTitles = titles;
        fetchedEpisodeTitle = titles.episodeTitle;
        fetchedReleaseDate = titles.releaseDate;
        forcedSeason = titles.forcedSeason; // Ambil nilai
        lastFetchedTitlesFileName = mpcStatus.rawFileName;
    } else if (cachedFetchedTitles) {
        fetchedEpisodeTitle = cachedFetchedTitles.episodeTitle;
        fetchedReleaseDate = cachedFetchedTitles.releaseDate;
        forcedSeason = cachedFetchedTitles.forcedSeason; // Ambil nilai
    }

    const currentAutoTrigger = `${config.autoPoster}-${config.autoEpisode}-${config.autoDate}`;
    // DIPERBAIKI: cek malID/config.mal_id dihapus dari needsFetch
    const needsFetch = isNewMedia || mpcStatus.rawFileName !== lastFetchedFileName ||
    mpcStatus.tmdbID !== lastTmdbId ||
    config.tmdb_id !== lastConfigTmdbId || currentAutoTrigger !== lastAutoTrigger;

    // DIPERBAIKI: kondisi trigger fetch tidak lagi menyertakan malID/config.mal_id
    if (needsFetch && (mpcStatus.tmdbID || config.tmdb_id || config.autoPoster || config.autoEpisode || config.autoDate)) {
        if (isNewMedia || mpcStatus.rawFileName !== lastFetchedFileName) {
            cachedPosters = []; currentPosterIndex = 0; currentCustomImageIndex = 0;
            cachedShowTitle = null; cachedApiEpisodeTitle = null; cachedPosterSource = null; cachedPosterDebug = null; cachedTmdbUrl = null; cachedTmdbReleaseDate = null; cachedTmdbTagline = null;
        }

        // DIPERBAIKI: mpcStatus.malID tidak lagi dikirim ke fetchMetadata
        const result = await fetchMetadata(mpcStatus.tmdbID, mpcStatus.groupID, mpcStatus.filePath, utils.cleanName(mpcStatus.rawFileName, config));
        if (!result.retry) {
            if (result.showTitle) showTitle = result.showTitle;

            cachedPosters = result.posters || []; currentPosterIndex = 0;
            if (config.randomPoster && cachedPosters.length > 1) {
                currentPosterIndex = Math.floor(Math.random() * cachedPosters.length);
            }
            lastSlideshowTick = Date.now();

            cachedShowTitle = result.showTitle || null;
            cachedApiEpisodeTitle = result.tmdbEpisodeTitle || null;
            cachedTmdbUrl = result.tmdbUrl || null;
            cachedTmdbReleaseDate = result.tmdbReleaseDate || null;
            cachedTmdbTagline = result.tmdbTagline || null;
            cachedPosterSource = result.source || 'Not Found';
            cachedPosterDebug = result.debugInfo || null;

            lastFetchedFileName = mpcStatus.rawFileName; lastTmdbId = mpcStatus.tmdbID;
            lastConfigTmdbId = config.tmdb_id; lastAutoTrigger = currentAutoTrigger;
        }
    }

    const validCustomImages = Array.isArray(config.customImage) ? config.customImage.filter(img => img.trim() !== "") : [];
    const hasCustomImage = validCustomImages.length > 0;

    // DIPERBAIKI: sebelumnya rotasi customImage (dari config.json) SELALU
    // berurutan, tidak peduli config.randomPoster on/off -- cuma poster TMDb
    // yang menghormati randomPoster. Sekarang keduanya (custom image ATAU
    // poster TMDb, mana pun yang sedang aktif dipakai) sama-sama ikut aturan
    // randomPoster: acak kalau ON, berurutan kalau OFF.
    //
    // largeImageKey di bawah memprioritaskan customImage kalau ada isinya
    // (hasCustomImage), baru fallback ke poster TMDb -- jadi rotasi di sini
    // juga mengikuti prioritas yang sama: kalau customImage aktif, ROTASI
    // customImage; kalau tidak, baru rotasi poster TMDb.
    if (!isNewMedia && config.slideshowInterval > 0) {
        const now = Date.now();
        if (now - lastSlideshowTick >= config.slideshowInterval * 1000) {
            if (hasCustomImage) {
                if (validCustomImages.length > 1) {
                    if (config.randomPoster) {
                        // Acak: pilih index random dari list customImage di config,
                        // pastikan tidak mengulang gambar yang sama persis
                        let newIdx = Math.floor(Math.random() * validCustomImages.length);
                        if (newIdx === currentCustomImageIndex) newIdx = (newIdx + 1) % validCustomImages.length;
                        currentCustomImageIndex = newIdx;
                    } else {
                        // Berurutan (default lama)
                        currentCustomImageIndex = (currentCustomImageIndex + 1) % validCustomImages.length;
                    }
                }
            } else if (cachedPosters.length > 1) {
                if (config.randomPoster) {
                    let newIdx = Math.floor(Math.random() * cachedPosters.length);
                    if (newIdx === currentPosterIndex) newIdx = (newIdx + 1) % cachedPosters.length;
                    currentPosterIndex = newIdx;
                } else {
                    // Berurutan: dipakai saat randomPoster OFF tapi slideshow tetap jalan
                    currentPosterIndex = (currentPosterIndex + 1) % cachedPosters.length;
                }
            }
            lastSlideshowTick = now;
        }
    }

    if (cachedShowTitle) showTitle = cachedShowTitle;

    let largeImageKey = 'https://i.imgur.com/MwZqLN8.png';
    if (hasCustomImage) {
        largeImageKey = validCustomImages[currentCustomImageIndex] || validCustomImages[0];
    } else if (config.autoPoster && cachedPosters.length > 0) {
        largeImageKey = cachedPosters[currentPosterIndex];
    }

    const parsedSE = utils.parseSeasonEpisode(mpcStatus.rawFileName);
    let finalEpisodeTitle = null;

    if (fetchedEpisodeTitle) {
        // Dari file lokal yang ADA ISINYA -> format sudah final, ikuti apa adanya
        finalEpisodeTitle = fetchedEpisodeTitle;
    } else if (config.autoEpisode && cachedApiEpisodeTitle && parsedSE.episode) {
        // Dari API (auto) TAPI dengan override Season dari file titles_sX.txt kosong
        // Dari TMDb API (auto) -> format episode BERGANTUNG pada nomor season:
        // - Season 0 (di TMDb ini artinya Specials/OVA/ONA/dsb) -> "Special Episode X: Title"
        // - Season 1                                            -> "Episode X: Title" (tanpa prefix season)
        // - Season 2 ke atas                                    -> "S0XE0X: Title"
        const actualSeason = forcedSeason !== null ? forcedSeason : parsedSE.season;
        const eFormat = String(parsedSE.episode).padStart(2, '0');

        if (actualSeason === 0) {
            finalEpisodeTitle = `Special Episode ${parsedSE.episode}: ${cachedApiEpisodeTitle}`;
        } else if (actualSeason >= 2) {
            const sFormat = String(actualSeason).padStart(2, '0');
            finalEpisodeTitle = `S${sFormat}E${eFormat}: ${cachedApiEpisodeTitle}`;
        } else {
            finalEpisodeTitle = `Episode ${parsedSE.episode}: ${cachedApiEpisodeTitle}`;
        }
    }

    const finalReleaseDate = (config.autoDate ? cachedTmdbReleaseDate : null) || fetchedReleaseDate;

    // Buat Payload Normal via payload.js bawaan Anda
    let activityPayload = buildPayload(mpcStatus, showTitle, finalEpisodeTitle, finalReleaseDate, largeImageKey, config, cachedTmdbUrl);

    // ==============================================================
    // KONDISI OVERRIDE (AUTO POSTER: OFF | AUTO EPISODE: ON)
    // ==============================================================
    if (!showTitle && finalEpisodeTitle) {
        if (mpcStatus.isPlaying) {
            activityPayload.details = mpcStatus.fileName; // Nama File mentah (dengan ekstensi)
            activityPayload.state = finalEpisodeTitle;    // Episode dari TMDb
        } else if (mpcStatus.isPaused) {
            activityPayload.details = mpcStatus.fileName; // Nama File mentah
            // Saat pause, payload.js biasanya sudah menyetel activityPayload.state ke "xx:xx / xx:xx"
            activityPayload.largeImageText = finalEpisodeTitle; // Override tanggal/teks dengan Judul Episode TMDb
        }
    }
    // ==============================================================

    // ==============================================================
    // KONDISI OVERRIDE UNTUK MOVIE (TAGLINE & RELEASE DATE)
    // ==============================================================
    if (cachedShowTitle && !config.customBigText?.trim() && cachedTmdbTagline) {
        activityPayload.largeImageText = `"${cachedTmdbTagline}"`;

        const taglineDate = (config.autoDate && cachedTmdbReleaseDate) || fetchedReleaseDate;
        if (taglineDate) activityPayload.smallImageText = `(${taglineDate})`;
    }
    // ==============================================================

    try {
        if (setActivity) await setActivity(activityPayload);
        const currentMediaState = mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');

        if (isNewMedia) {
            // Sumber ID: txt folder video > config.json manual override > auto via nama file
            // (Metadata video/ffprobe TIDAK dipakai untuk ID sama sekali)
            // DIPERBAIKI: referensi debugIds.txt.mal & config.mal_id dihapus
            const idSource = (mpcStatus.debugIds.txt.tmdb || mpcStatus.debugIds.txt.group) ? "Video Folder TXT" :
            (config.tmdb_id) ? "config.json (Manual Override)" :
            (cachedPosterSource && cachedPosterSource.includes('AutoPoster')) ? "Auto (Filename Search)" : "Not Found";

            // Sumber judul yang ditampilkan (details)
            const titleSource = (config.customText?.trim()) ? `Config customText -> "${config.customText}"` :
            (!showTitle && finalEpisodeTitle) ? `autoPoster OFF -> Fallback to filename "${mpcStatus.fileName}"` :
            (finalEpisodeTitle) ? `Episode Title -> "${finalEpisodeTitle}"` :
            (!config.autoEpisode && !fetchedEpisodeTitle) ? `Not Found -> autoEpisode is OFF in config` :
            (!mpcStatus.isFallback && mpcStatus.title) ? `Video Metadata -> "${mpcStatus.title}"` :
            `Not Found -> Fallback to filename "${mpcStatus.fileName}"`;

            // Sumber gambar (poster)
            const imageSource = (hasCustomImage) ? `Config customImage -> Active (${validCustomImages.length} URL${validCustomImages.length > 1 ? 's' : ''})` :
            (!config.autoPoster) ? `Not Found -> autoPoster is OFF in config` :
            (cachedPosterSource && cachedPosterSource !== 'Not Found' && cachedPosterSource !== 'Error') ? `Success via ${cachedPosterSource} (${cachedPosters.length} poster${cachedPosters.length !== 1 ? 's' : ''} loaded)` :
            `Not Found -> Fallback to default MPC-HC logo`;

            // Sumber teks besar (large image text)
            const bigTextSource = (config.customBigText?.trim()) ? `Config customBigText -> "${config.customBigText}"` :
            (!showTitle && finalEpisodeTitle && mpcStatus.isPaused) ? `Overridden with Episode Title -> "${finalEpisodeTitle}"` :
            (config.autoDate && cachedTmdbReleaseDate) ? `TMDb API Date -> "${cachedTmdbReleaseDate}"` :
            (!config.autoDate && !fetchedReleaseDate) ? `Not Found -> autoDate is OFF in config` :
            (fetchedReleaseDate) ? `titles.txt -> "${fetchedReleaseDate}"` :
            `Not Found -> Fallback to "MPC-HC"`;

            const customImageURL = hasCustomImage ? "used" : null;
            const debugData = {
                idSource, titleSource, imageSource, bigTextSource,
                cachedFetchedTitles, cachedPosterDebug, cachedPosterSource, customImageURL,
                cachedApiEpisodeTitle: config.autoEpisode ? cachedApiEpisodeTitle : null,
                fetchedEpisodeTitle,
                posterCount: cachedPosters.length,
            };

            logger.logNewMedia(mpcStatus, activityPayload, debugData, config);
        } else {
            logger.logStateUpdate(currentMediaState, activityPayload);
        }
    } catch (err) {}
}

module.exports = { getConfig, handleStatus, setUpdateCallback };
