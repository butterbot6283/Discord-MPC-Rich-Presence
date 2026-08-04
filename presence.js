const fs = require('fs');
const path = require('path');
const mpc = require('./mpc');
const { buildPayload } = require('./payload');
const logger = require('./logger');
const { fetchTitles } = require('./titles');
const fetchPoster = require('./poster');
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
let cachedShowTitle = null, cachedApiEpisodeTitle = null, cachedPosterSource = null, cachedTmdbUrl = null, cachedTmdbReleaseDate = null, cachedPosterDebug = null;
let lastFetchedFileName = null, lastTmdbId = null, lastMalId = null, lastConfigTmdbId = null, lastConfigMalId = null, lastAutoTrigger = null;
let lastFetchedTitlesFileName = null, cachedFetchedTitles = null;

let currentWatchedFolder = null;
let txtWatcher = null;

const resetAllCaches = () => {
    mpc.resetMpcCache();
    cachedFetchedTitles = null; lastFetchedTitlesFileName = null; 
    cachedPosters = []; currentPosterIndex = 0; currentCustomImageIndex = 0;
    cachedShowTitle = null; cachedApiEpisodeTitle = null; cachedPosterSource = null; cachedPosterDebug = null; cachedTmdbUrl = null; cachedTmdbReleaseDate = null;
    lastFetchedFileName = null; lastTmdbId = null; lastMalId = null;
    lastConfigTmdbId = null; lastConfigMalId = null; lastAutoTrigger = null;
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

            const apiChanged = oldConfig.autoPoster !== newConfig.autoPoster ||
                               oldConfig.autoEpisode !== newConfig.autoEpisode ||
                               oldConfig.autoDate !== newConfig.autoDate ||
                               oldConfig.romajiTitle !== newConfig.romajiTitle ||
                               oldConfig.dont !== newConfig.dont ||
                               oldConfig.tmdb_id !== newConfig.tmdb_id ||
                               oldConfig.mal_id !== newConfig.mal_id ||
                               oldConfig.cleanFilename !== newConfig.cleanFilename;

            const visualChanged = oldConfig.customText !== newConfig.customText ||
                                  oldConfig.customBigText !== newConfig.customBigText ||
                                  oldConfig.randomPoster !== newConfig.randomPoster ||
                                  oldConfig.slideshowInterval !== newConfig.slideshowInterval ||
                                  JSON.stringify(oldConfig.customImage) !== JSON.stringify(newConfig.customImage);

            if (apiChanged || visualChanged) {
                console.log(`\n🔄 [LIVE CONFIG] Perubahan pengaturan terdeteksi dari menu.js!`);
                if (apiChanged) {
                    console.log(`   ⚙️ API Settings berubah -> Mereset Cache TMDb dan Menarik Ulang Data...`);
                    resetAllCaches();
                } else {
                    console.log(`   🎨 Visual Settings berubah -> Memperbarui tampilan Discord...`);
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
    if (!status || status.isOffline) {
        logger.logOffline();
        lastPlaybackState = 'offline';
        try { client.user?.clearActivity(); } catch (err) {}
        resetAllCaches();
        return;
    }

    logger.resetOfflineStatus();
    const currentState = status.isPlaying ? 'playing' : (status.isPaused ? 'paused' : 'stopped');

    if (currentState === 'playing' || currentState !== lastPlaybackState) {
        lastPlaybackState = currentState;
        await updatePresence(status, async (payload) => {
            try { client.user?.setActivity(payload); } catch (e) {}
        });
    }
}

async function updatePresence(mpcStatus, setActivity) {
    if (!mpcStatus) return;

    let showTitle = null; 
    const isNewMedia = (mpcStatus.rawFileName !== lastFetchedTitlesFileName);
    let fetchedEpisodeTitle = null;
    let fetchedReleaseDate = null;

    // LIVE TXT WATCHER (Memantau file .txt di folder video secara real-time)
    const currentFolder = mpcStatus.filePath ? path.dirname(mpcStatus.filePath) : null;
    if (currentFolder && currentFolder !== currentWatchedFolder) {
        if (txtWatcher) txtWatcher.close();
        currentWatchedFolder = currentFolder;
        try {
            txtWatcher = fs.watch(currentFolder, (eventType, filename) => {
                if (filename && filename.match(/^(tmdb|mal|titles|group)\.txt$/i)) {
                    console.log(`\n🔄 [TXT WATCHER] Perubahan file ${filename} terdeteksi! Memuat ulang data...`);
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
        lastFetchedTitlesFileName = mpcStatus.rawFileName;
    } else if (cachedFetchedTitles) {
        fetchedEpisodeTitle = cachedFetchedTitles.episodeTitle;
        fetchedReleaseDate = cachedFetchedTitles.releaseDate;
    }

    const currentAutoTrigger = `${config.autoPoster}-${config.autoEpisode}-${config.autoDate}`;
    const needsFetch = isNewMedia || mpcStatus.rawFileName !== lastFetchedFileName || 
        mpcStatus.tmdbID !== lastTmdbId || mpcStatus.malID !== lastMalId ||
        config.tmdb_id !== lastConfigTmdbId || config.mal_id !== lastConfigMalId || currentAutoTrigger !== lastAutoTrigger;

    if (needsFetch && (mpcStatus.tmdbID || mpcStatus.malID || config.tmdb_id || config.mal_id || config.autoPoster || config.autoEpisode || config.autoDate)) {
        if (isNewMedia || mpcStatus.rawFileName !== lastFetchedFileName) {
            cachedPosters = []; currentPosterIndex = 0; currentCustomImageIndex = 0;
            cachedShowTitle = null; cachedApiEpisodeTitle = null; cachedPosterSource = null; cachedPosterDebug = null; cachedTmdbUrl = null; cachedTmdbReleaseDate = null;
        }

        const result = await fetchPoster(mpcStatus.tmdbID, mpcStatus.malID, mpcStatus.groupID, mpcStatus.filePath, utils.cleanName(mpcStatus.rawFileName, config));
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
            cachedPosterSource = result.source || 'Not Found'; 
            cachedPosterDebug = result.debugInfo || null;
            
            lastFetchedFileName = mpcStatus.rawFileName; lastTmdbId = mpcStatus.tmdbID; lastMalId = mpcStatus.malID;
            lastConfigTmdbId = config.tmdb_id; lastConfigMalId = config.mal_id; lastAutoTrigger = currentAutoTrigger;
        }
    } 

    const validCustomImages = Array.isArray(config.customImage) ? config.customImage.filter(img => img.trim() !== "") : [];
    const hasCustomImage = validCustomImages.length > 0;

    if (!isNewMedia && config.slideshowInterval > 0) {
        const now = Date.now();
        if (now - lastSlideshowTick >= config.slideshowInterval * 1000) {
            if (hasCustomImage && validCustomImages.length > 1) {
                currentCustomImageIndex = (currentCustomImageIndex + 1) % validCustomImages.length;
            }
            if (cachedPosters.length > 1) {
                if (config.randomPoster) {
                    let newIdx = Math.floor(Math.random() * cachedPosters.length);
                    if (newIdx === currentPosterIndex) newIdx = (newIdx + 1) % cachedPosters.length;
                    currentPosterIndex = newIdx;
                } else {
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
        finalEpisodeTitle = fetchedEpisodeTitle;
    } else if (config.autoEpisode && cachedApiEpisodeTitle && parsedSE.episode) {
        if (parsedSE.season >= 2 || parsedSE.isExplicit) {
            const sFormat = String(parsedSE.season).padStart(2, '0');
            const eFormat = String(parsedSE.episode).padStart(2, '0');
            finalEpisodeTitle = `S${sFormat}E${eFormat}: ${cachedApiEpisodeTitle}`;
        } else {
            finalEpisodeTitle = `Episode ${parsedSE.episode}: ${cachedApiEpisodeTitle}`;
        }
    }

    const finalReleaseDate = (config.autoDate ? cachedTmdbReleaseDate : null) || fetchedReleaseDate || mpcStatus.releaseDate;

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

    try {
        if (setActivity) await setActivity(activityPayload);
        const currentMediaState = mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');
        
        if (isNewMedia) {
            const idSource = (mpcStatus.debugIds.metadata.imdb || mpcStatus.debugIds.metadata.mal || mpcStatus.debugIds.metadata.tmdb) ? "Metadata File" :
                             (mpcStatus.debugIds.txt.imdb || mpcStatus.debugIds.txt.mal || mpcStatus.debugIds.txt.tmdb || mpcStatus.debugIds.txt.group) ? "Txt Folder Video" :
                             (config.imdb_id || config.mal_id || config.tmdb_id) ? "Config.json (Manual Override)" : "TIDAK DITEMUKAN";

            const titleSource = (config.customText?.trim()) ? `Config customText -> "${config.customText}"` :
                                (!showTitle && finalEpisodeTitle) ? `autoPoster OFF -> Fallback ke Nama File "${mpcStatus.fileName}"` :
                                (finalEpisodeTitle) ? `Judul Episode -> "${finalEpisodeTitle}"` :
                                (!config.autoEpisode && !fetchedEpisodeTitle) ? `TIDAK DITEMUKAN -> autoEpisode (Nonaktif di Config)` :
                                (!mpcStatus.isFallback && mpcStatus.title) ? `Metadata Video -> "${mpcStatus.title}"` :
                                `TIDAK DITEMUKAN -> Fallback ke Nama File "${mpcStatus.fileName}"`;

            const imageSource = (hasCustomImage) ? `Config customImage -> Aktif (${validCustomImages.length} URL)` :
                                (!config.autoPoster) ? `TIDAK DITEMUKAN -> autoPoster (Nonaktif di Config)` :
                                (cachedPosterSource && cachedPosterSource !== 'Not Found' && cachedPosterSource !== 'Error') ? `Sukses via ${cachedPosterSource} (Memuat ${cachedPosters.length} Poster)` :
                                `TIDAK DITEMUKAN -> Fallback ke Logo MPC-HC Default`;

            const bigTextSource = (config.customBigText?.trim()) ? `Config customBigText -> "${config.customBigText}"` :
                                  (!showTitle && finalEpisodeTitle && mpcStatus.isPaused) ? `Di-override dengan Judul Episode -> "${finalEpisodeTitle}"` :
                                  (config.autoDate && cachedTmdbReleaseDate) ? `API TMDb Date -> "${cachedTmdbReleaseDate}"` :
                                  (!config.autoDate && !fetchedReleaseDate) ? `TIDAK DITEMUKAN -> autoDate (Nonaktif di Config)` :
                                  (fetchedReleaseDate) ? `titles.txt -> "${fetchedReleaseDate}"` :
                                  (mpcStatus.releaseDate) ? `Metadata Video -> "${mpcStatus.releaseDate}"` :
                                  `TIDAK DITEMUKAN -> Fallback ke "MPC-HC"`;

            const customImageURL = hasCustomImage ? "used" : null; 
            const debugData = { idSource, titleSource, imageSource, bigTextSource, cachedFetchedTitles, cachedPosterDebug, cachedPosterSource, customImageURL, cachedApiEpisodeTitle: config.autoEpisode ? cachedApiEpisodeTitle : null, fetchedEpisodeTitle };
            
            logger.logNewMedia(mpcStatus, activityPayload, debugData, config);
        } else {
            logger.logStateUpdate(currentMediaState, activityPayload);
        }
    } catch (err) {}
}

module.exports = { getConfig, handleStatus, setUpdateCallback };
