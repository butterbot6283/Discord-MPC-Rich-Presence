// presence.js
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

let cachedPosters = [], currentPosterIndex = 0, lastSlideshowTick = 0;
let currentCustomImageIndex = 0;
let cachedShowTitle = null, cachedApiEpisodeTitle = null, cachedPosterSource = null, cachedMediaUrl = null, cachedTitleSourceDebug = 'none', cachedAnilistMatchMode = null, cachedTmdbReleaseDate = null, cachedPosterDebug = null, cachedTmdbTagline = null, cachedMediaType = null;
let lastFetchedFileName = null, lastTmdbId = null, lastConfigTmdbId = null, lastAutoTrigger = null;
let lastFetchedTitlesFileName = null, cachedFetchedTitles = null;

let currentWatchedFolder = null;
let txtWatcher = null;
let txtWatchTimeout = null;

// Presence/metadata caches only. MPC's ffprobe and player-information caches
// are intentionally kept alive so a TXT/config change does not cause ffprobe
// or /info.html to run again unnecessarily.
const resetPresenceCaches = () => {
    cachedFetchedTitles = null;
    lastFetchedTitlesFileName = null;
    cachedPosters = []; currentPosterIndex = 0; currentCustomImageIndex = 0;
    cachedShowTitle = null; cachedAnilistMatchMode = null; cachedApiEpisodeTitle = null; cachedPosterSource = null; cachedPosterDebug = null; cachedMediaUrl = null; cachedTitleSourceDebug = 'none'; cachedTmdbReleaseDate = null; cachedTmdbTagline = null; cachedMediaType = null;
    lastFetchedFileName = null; lastTmdbId = null;
    lastConfigTmdbId = null; lastAutoTrigger = null;
};

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
            oldConfig.cleanFilename !== newConfig.cleanFilename;

            const visualChanged = oldConfig.customText !== newConfig.customText ||
            oldConfig.customBigText !== newConfig.customBigText ||
            oldConfig.randomPoster !== newConfig.randomPoster ||
            oldConfig.slideshowInterval !== newConfig.slideshowInterval ||
            JSON.stringify(oldConfig.customImage) !== JSON.stringify(newConfig.customImage);

            if (apiChanged || visualChanged) {
                const changedKeys = Object.keys(newConfig).filter(k => JSON.stringify(oldConfig[k]) !== JSON.stringify(newConfig[k]));
                logger.logConfigChanged(changedKeys, apiChanged);
                if (apiChanged) {
                    resetPresenceCaches();
                }

                if (lastMpcStatus && !lastMpcStatus.isOffline && updateCallback) {
                    // Config changes are event-driven. Do not wait for the next
                    // 5-second MPC poll before updating Discord.
                    await updatePresence(lastMpcStatus, updateCallback);
                }
            }
        }, 500);
    }
});

const setUpdateCallback = (cb) => { updateCallback = cb; };
const getConfig = () => config;

async function refreshPresenceAfterTxtChange(filename) {
    if (!lastMpcStatus || lastMpcStatus.isOffline || !updateCallback || !currentWatchedFolder) return;

    // Reset only the presence/metadata layer. Keep ffprobe/player caches.
    resetPresenceCaches();

    // tmdb.txt/group.txt/mal.txt are cached in mpc.js, so explicitly refresh
    // them only when a relevant TXT file actually changes.
    if (/^(tmdb|group|mal)\.txt$/i.test(filename)) {
        mpc.refreshTxtMetadata(currentWatchedFolder);
    }

    // Fetch the current MPC state once so newly changed TXT metadata is
    // reflected immediately. This is event-driven, not a repeating poll.
    const freshStatus = await mpc.getMpcStatus(config);
    if (!freshStatus || freshStatus.isOffline || freshStatus.isError) return;

    lastMpcStatus = freshStatus;
    await updatePresence(freshStatus, updateCallback);
}

function watchVideoFolder(folder) {
    if (folder === currentWatchedFolder) return;

    if (txtWatcher) txtWatcher.close();
    if (txtWatchTimeout) clearTimeout(txtWatchTimeout);

    currentWatchedFolder = folder;
    if (!folder) {
        txtWatcher = null;
        return;
    }

    // Prime the TXT cache once when entering a new folder. Subsequent 5-second
    // MPC polls reuse this cached result and do not touch the TXT files.
    mpc.refreshTxtMetadata(folder);

    try {
        txtWatcher = fs.watch(folder, (eventType, filename) => {
            if (!filename || !/^(tmdb|titles|group|mal)\.txt$/i.test(filename)) return;

            logger.logTxtWatcherEvent(filename);

            // Editors may emit multiple fs.watch events for one save/replace.
            // Debounce them so one logical edit causes only one RPC refresh.
            if (txtWatchTimeout) clearTimeout(txtWatchTimeout);
            txtWatchTimeout = setTimeout(async () => {
                try {
                    await refreshPresenceAfterTxtChange(filename);
                } catch (e) {}
            }, 200);
        });
    } catch (e) {
        txtWatcher = null;
    }
}

async function handleStatus(status, client) {
    lastMpcStatus = status;

    if (status && status.isError) {
        logger.logMpcError(status.errorCode, status.errorMessage);
        lastPlaybackState = 'offline';
        if (client && client.user) client.user.clearActivity().catch(() => {});
        resetPresenceCaches();
        mpc.resetMpcCache();
        return;
    }

    if (!status || status.isOffline) {
        logger.logOffline();
        lastPlaybackState = 'offline';
        if (client && client.user) client.user.clearActivity().catch(() => {});
        resetPresenceCaches();
        mpc.resetMpcCache();
        return;
    }

    logger.resetOfflineStatus();
    const currentState = status.isPlaying ? 'playing' : (status.isPaused ? 'paused' : 'stopped');
    lastPlaybackState = currentState;

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

    const currentFolder = mpcStatus.filePath ? path.dirname(mpcStatus.filePath) : null;
    if (currentFolder && currentFolder !== currentWatchedFolder) {
        watchVideoFolder(currentFolder);
    }

    if (isNewMedia) {
        const titles = await fetchTitles(mpcStatus.fileName, mpcStatus.filePath || null);
        cachedFetchedTitles = titles;
        fetchedEpisodeTitle = titles.episodeTitle;
        fetchedReleaseDate = titles.releaseDate;
        forcedSeason = titles.forcedSeason;
        lastFetchedTitlesFileName = mpcStatus.rawFileName;
    } else if (cachedFetchedTitles) {
        fetchedEpisodeTitle = cachedFetchedTitles.episodeTitle;
        fetchedReleaseDate = cachedFetchedTitles.releaseDate;
        forcedSeason = cachedFetchedTitles.forcedSeason;
    }

    const currentAutoTrigger = `${config.autoPoster}-${config.autoEpisode}-${config.autoDate}`;
    const needsFetch = isNewMedia || mpcStatus.rawFileName !== lastFetchedFileName ||
    mpcStatus.tmdbID !== lastTmdbId ||
    config.tmdb_id !== lastConfigTmdbId || currentAutoTrigger !== lastAutoTrigger;

    if (needsFetch && (mpcStatus.tmdbID || config.tmdb_id || config.autoPoster || config.autoEpisode || config.autoDate)) {
        if (isNewMedia || mpcStatus.rawFileName !== lastFetchedFileName) {
            cachedPosters = []; currentPosterIndex = 0; currentCustomImageIndex = 0;
            cachedShowTitle = null; cachedAnilistMatchMode = null; cachedApiEpisodeTitle = null; cachedPosterSource = null; cachedPosterDebug = null; cachedMediaUrl = null; cachedTitleSourceDebug = 'none'; cachedTmdbReleaseDate = null; cachedTmdbTagline = null;
        }

        const result = await fetchMetadata(mpcStatus.tmdbID, mpcStatus.groupID, mpcStatus.malID, mpcStatus.filePath, utils.cleanName(mpcStatus.rawFileName, config));
        if (!result.retry) {
            if (result.showTitle) showTitle = result.showTitle;

            cachedPosters = result.posters || []; currentPosterIndex = 0;
            if (config.randomPoster && cachedPosters.length > 1) {
                currentPosterIndex = Math.floor(Math.random() * cachedPosters.length);
            }
            lastSlideshowTick = Date.now();

            cachedShowTitle = result.showTitle || null;
            cachedAnilistMatchMode = result.anilistMatchMode || (result.titleSourceDebug === 'anilist' ? 'anilist' : null);
            cachedApiEpisodeTitle = result.tmdbEpisodeTitle || null;
            cachedMediaUrl = result.mediaUrl || null;
            cachedTitleSourceDebug = result.titleSourceDebug || 'none';
            cachedTmdbReleaseDate = result.tmdbReleaseDate || null;
            cachedTmdbTagline = result.tmdbTagline || null;
            cachedPosterSource = result.source || 'Not Found';
            cachedPosterDebug = result.debugInfo || null;
			cachedMediaType = result.mediaType || null;

            lastFetchedFileName = mpcStatus.rawFileName; lastTmdbId = mpcStatus.tmdbID;
            lastConfigTmdbId = config.tmdb_id; lastAutoTrigger = currentAutoTrigger;
        }
    }

    const validCustomImages = Array.isArray(config.customImage) ? config.customImage.filter(img => img.trim() !== "") : [];
    const hasCustomImage = validCustomImages.length > 0;

    if (!isNewMedia && config.slideshowInterval > 0) {
        const now = Date.now();
        if (now - lastSlideshowTick >= config.slideshowInterval * 1000) {
            if (hasCustomImage) {
                if (validCustomImages.length > 1) {
                    if (config.randomPoster) {
                        let newIdx = Math.floor(Math.random() * validCustomImages.length);
                        if (newIdx === currentCustomImageIndex) newIdx = (newIdx + 1) % validCustomImages.length;
                        currentCustomImageIndex = newIdx;
                    } else {
                        currentCustomImageIndex = (currentCustomImageIndex + 1) % validCustomImages.length;
                    }
                }
            } else if (cachedPosters.length > 1) {
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

    const playerAppearance = mpcStatus.playerAppearance || mpc.DEFAULT_PLAYER_APPEARANCE;
    let largeImageKey = playerAppearance.largeImageKey;
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
        const actualSeason = forcedSeason !== null ? forcedSeason : parsedSE.season;
        const eFormat = String(parsedSE.episode).padStart(2, '0');

        if (actualSeason === 0) {
            finalEpisodeTitle = `Special Episode ${parsedSE.episode}: ${cachedApiEpisodeTitle}`;
        } else if (cachedTitleSourceDebug === 'anilist' && config.romajiTitle) {
            finalEpisodeTitle = `Episode ${parsedSE.episode}: ${cachedApiEpisodeTitle}`;
        } else if (actualSeason >= 2) {
            const sFormat = String(actualSeason).padStart(2, '0');
            finalEpisodeTitle = `S${sFormat}E${eFormat}: ${cachedApiEpisodeTitle}`;
        } else {
            finalEpisodeTitle = `Episode ${parsedSE.episode}: ${cachedApiEpisodeTitle}`;
        }
    }

    const finalReleaseDate = (config.autoDate ? cachedTmdbReleaseDate : null) || fetchedReleaseDate;

    let activityPayload = buildPayload(mpcStatus, showTitle, finalEpisodeTitle, finalReleaseDate, largeImageKey, config, cachedMediaUrl, cachedMediaType);

    if (!showTitle && finalEpisodeTitle) {
        if (mpcStatus.isPlaying) {
            activityPayload.details = mpcStatus.fileName;
            activityPayload.state = finalEpisodeTitle;
        } else if (mpcStatus.isPaused) {
            activityPayload.details = mpcStatus.fileName;
            activityPayload.largeImageText = finalEpisodeTitle;
        }
    }

    // Movie tagline/release-date override is only valid for an active media
    // payload. When MPC-HC is stopped, payload.js intentionally builds a clean
    // Idle payload ("Idling" / "Nothing is playing" / "Idle"). Do not leak
    // metadata from the last played movie into that stopped state.
    if (!mpcStatus.isStopped && cachedShowTitle && !config.customBigText?.trim() && cachedTmdbTagline) {
        activityPayload.largeImageText = `"${cachedTmdbTagline}"`;

        const taglineDate = (config.autoDate && cachedTmdbReleaseDate) || fetchedReleaseDate;
        if (taglineDate) activityPayload.smallImageText = `(${taglineDate})`;
    }

    // Final stopped-state safety: never carry metadata from the last video
    // into Idle/Stopped. payload.js already supplies the intended idle values;
    // this guard enforces them after all presence-level overrides.
    if (mpcStatus.isStopped) {
        activityPayload.name = undefined;
        activityPayload.details = playerAppearance.name;
        activityPayload.state = 'Nothing is playing';
        activityPayload.smallImageText = 'Idle';
        activityPayload.largeImageKey = playerAppearance.largeImageKey;
        activityPayload.largeImageText = playerAppearance.name;
        activityPayload.detailsUrl = playerAppearance.link;
        activityPayload.buttons = [
            {
                label: 'MPC Rich Presence',
                url: 'https://github.com/butterbot6283/Discord-MPC-Rich-Presence'
            }
        ];
    }

    try {
        if (setActivity) await setActivity(activityPayload);
        const currentMediaState = mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');

        if (isNewMedia) {
            const idSource = (mpcStatus.debugIds.txt.tmdb || mpcStatus.debugIds.txt.group || mpcStatus.debugIds.txt.mal) ? "Video Folder TXT" :
            (config.tmdb_id) ? "config.json (Manual Override)" :
            (cachedPosterSource && cachedPosterSource.includes('AutoPoster')) ? "Auto (Filename Search)" : "Not Found";

            const titleSource = (config.customText?.trim()) ? `Config customText -> "${config.customText}"` :
            (!showTitle && finalEpisodeTitle) ? `autoPoster OFF -> Fallback to filename "${mpcStatus.fileName}"` :
            (finalEpisodeTitle) ? `Episode Title -> "${finalEpisodeTitle}"` :
            (!config.autoEpisode && !fetchedEpisodeTitle) ? `Not Found -> autoEpisode is OFF in config` :
            (!mpcStatus.isFallback && mpcStatus.title) ? `Video Metadata -> "${mpcStatus.title}"` :
            `Not Found -> Fallback to filename "${mpcStatus.fileName}"`;

            const imageSource = (hasCustomImage) ? `Config customImage -> Active (${validCustomImages.length} URL${validCustomImages.length > 1 ? 's' : ''})` :
            (!config.autoPoster) ? `Not Found -> autoPoster is OFF in config` :
            (cachedPosterSource && cachedPosterSource !== 'Not Found' && cachedPosterSource !== 'Error') ? `Success via ${cachedPosterSource} (${cachedPosters.length} poster${cachedPosters.length !== 1 ? 's' : ''} loaded)` :
            `Not Found -> Fallback to default ${playerAppearance.name} logo`;

            const bigTextSource = (config.customBigText?.trim()) ? `Config customBigText -> "${config.customBigText}"` :
            (!showTitle && finalEpisodeTitle && mpcStatus.isPaused) ? `Overridden with Episode Title -> "${finalEpisodeTitle}"` :
            (config.autoDate && cachedTmdbReleaseDate) ? `TMDb API Date -> "${cachedTmdbReleaseDate}"` :
            (!config.autoDate && !fetchedReleaseDate) ? `Not Found -> autoDate is OFF in config` :
            (fetchedReleaseDate) ? `titles.txt -> "${fetchedReleaseDate}"` :
            `Not Found -> Fallback to "${playerAppearance.name}"`;

            const customImageURL = hasCustomImage ? "used" : null;
            const debugData = {
                idSource, titleSource, imageSource, bigTextSource,
                cachedFetchedTitles, cachedPosterDebug, cachedPosterSource, customImageURL,
                cachedApiEpisodeTitle: config.autoEpisode ? cachedApiEpisodeTitle : null,
                fetchedEpisodeTitle,
                posterCount: cachedPosters.length,
                showTitle: showTitle,
                titleSourceDebug: cachedTitleSourceDebug,
                anilistMatchMode: cachedAnilistMatchMode
            };

            logger.logNewMedia(mpcStatus, activityPayload, debugData, config);
        } else {
            logger.logStateUpdate(currentMediaState, activityPayload);
        }
    } catch (err) {}
}

module.exports = { getConfig, handleStatus, setUpdateCallback };
