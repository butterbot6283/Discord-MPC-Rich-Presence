const axios = require('axios');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);
const { fetchIdsFromTxt, fetchCachedIds } = require('./metadata');
const { cleanName } = require('./utils');

let lastFilePath = null;
let cachedMetadata = null;
let cachedPlayerAppearance = null;
let nextPlayerInfoRetryAt = 0;
let cachedTxtDirectory = null;
let cachedTxtIds = { tmdbID: null, groupID: null, malID: null };

// The WebServer's info.html identifies the player build. Keep the Discord
// fallback artwork here so every caller uses the same player-specific value.
const MPC_APPEARANCES = {
    'MPC-HC': { name: 'MPC-HC', link: 'https://github.com/clsid2/mpc-hc', largeImageKey: 'https://i.imgur.com/MwZqLN8.png' },
    'MPC-BE': { name: 'MPC-BE', link: 'https://github.com/Aleksoid1978/MPC-BE', largeImageKey: 'https://i.imgur.com/2cdLids.png' },
    'MPC-QT': { name: 'MPC-QT', link: 'https://github.com/mpc-qt/mpc-qt', largeImageKey: 'https://i.imgur.com/lJlHY25.png' },
};
const DEFAULT_PLAYER_APPEARANCE = MPC_APPEARANCES['MPC-HC'];

const resetMpcCache = () => {
    lastFilePath = null;
    cachedMetadata = null;
    cachedPlayerAppearance = null;
    nextPlayerInfoRetryAt = 0;
};

function refreshTxtMetadata(videoDir) {
    if (!videoDir) {
        cachedTxtDirectory = null;
        cachedTxtIds = { tmdbID: null, groupID: null, malID: null };
        return cachedTxtIds;
    }

    cachedTxtDirectory = videoDir;
    cachedTxtIds = fetchIdsFromTxt(videoDir);
    return cachedTxtIds;
}

function getTxtMetadata(videoDir) {
    if (videoDir !== cachedTxtDirectory) {
        return refreshTxtMetadata(videoDir);
    }
    return cachedTxtIds;
}

function detectPlayerAppearance(infoHtml) {
    const infoText = String(infoHtml || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

    if (/\bMPC\s*[- ]\s*BE\b/i.test(infoText)) return MPC_APPEARANCES['MPC-BE'];
    if (/\bMPC\s*[- ]\s*QT\b/i.test(infoText)) return MPC_APPEARANCES['MPC-QT'];
    if (/\bMPC\s*[- ]\s*HC\b/i.test(infoText)) return MPC_APPEARANCES['MPC-HC'];
    return null;
}

async function getPlayerAppearance() {
    if (cachedPlayerAppearance) return cachedPlayerAppearance;
    if (Date.now() < nextPlayerInfoRetryAt) return DEFAULT_PLAYER_APPEARANCE;

    try {
        const response = await axios.get('http://127.0.0.1:13579/info.html', { timeout: 2000 });
        cachedPlayerAppearance = detectPlayerAppearance(response.data) || DEFAULT_PLAYER_APPEARANCE;
        return cachedPlayerAppearance;
    } catch (_) {
        // Do not let an unavailable info endpoint interrupt normal playback.
        // Try again later in case the WebServer is still starting up.
        nextPlayerInfoRetryAt = Date.now() + 10000;
        return DEFAULT_PLAYER_APPEARANCE;
    }
}

const getMpcStatus = async (config) => {
    try {
        const [response, playerAppearance] = await Promise.all([
            axios.get('http://127.0.0.1:13579/variables.html'),
                                                               getPlayerAppearance(),
        ]);
        const data = response.data;
        const fileNameMatch = data.match(/<p id="file">(.+?)<\/p>/);
        let rawFileName = fileNameMatch ? fileNameMatch[1].trim() : 'Unknown File';
        const cleanedFileName = cleanName(rawFileName, config);
        const filePathMatch = data.match(/<p id="filepath">(.+?)<\/p>/);
        const filePath = filePathMatch ? decodeURIComponent(filePathMatch[1].trim()) : null;

        let ids = { tmdbID: null, groupID: null, malID: null };
        let debugIds = { txt: { tmdb: null, group: null, mal: null }, cache: { tmdb: null, group: null, mal: null }, config: { tmdb: config.tmdb_id } };
        let movieName = null;
        let isFallback = false;

        if (filePath) {
            if (filePath !== lastFilePath || !cachedMetadata) {
                try {
                    const { stdout } = await execFilePromise('ffprobe', ['-v','quiet','-print_format','json','-show_format',filePath], { timeout: 3000 });
                    const metadata = JSON.parse(stdout);
                    const tags = metadata.format?.tags || {};
                    const getTag = (keyName) => {
                        const foundKey = Object.keys(tags).find(k => k.toLowerCase() === keyName.toLowerCase());
                        return foundKey ? tags[foundKey] : null;
                    };
                    cachedMetadata = { metaTitle: getTag('title'), isError: false };
                    lastFilePath = filePath;
                } catch (err) {
                    let errorType = 'other';
                    if (err.killed || err.signal === 'SIGTERM' || /timed? ?out/i.test(err.message || '')) errorType = 'timeout';
                    else if (err.code === 'ENOENT') errorType = 'not_installed';
                    cachedMetadata = { isError: true, errorType };
                    lastFilePath = filePath;
                }
            }

            const videoDir = path.dirname(filePath);
            const txtIds = getTxtMetadata(videoDir);
            const cacheIds = fetchCachedIds(videoDir, cleanedFileName);
            ids.tmdbID = txtIds.tmdbID || cacheIds.tmdbID || null;
            ids.groupID = txtIds.groupID || cacheIds.groupID || null;
            ids.malID = txtIds.malID || cacheIds.malID || null;
            debugIds.txt = { tmdb: txtIds.tmdbID, group: txtIds.groupID, mal: txtIds.malID };
            debugIds.cache = { tmdb: cacheIds.tmdbID, group: cacheIds.groupID, mal: cacheIds.malID };

            if (!ids.tmdbID) ids.tmdbID = config.tmdb_id?.trim() || null;

            const metaTitle = cachedMetadata && !cachedMetadata.isError ? cachedMetadata.metaTitle : null;
            if (config.customText && config.customText.trim()) movieName = config.customText;
            else if (metaTitle && metaTitle.length <= 128) movieName = metaTitle;
            else { movieName = cleanedFileName; isFallback = true; }
        } else {
            movieName = cleanedFileName; isFallback = true;
            ids = { tmdbID: config.tmdb_id?.trim() || null, groupID: null, malID: null };
        }

        const cleanedMovieName = cleanName(movieName, config);
        const currentTimeMatch = data.match(/(\d{2}:\d{2}:\d{2})/g);
        const currentTime = currentTimeMatch ? currentTimeMatch[0] : '00:00:00';
        const totalTime = currentTimeMatch ? currentTimeMatch[1] : '00:00:00';
        const convertTimeToSec = (time) => { const parts = time.split(':').map(Number); return parts[0]*3600 + parts[1]*60 + parts[2]; };
        const ffprobeStatus = cachedMetadata && cachedMetadata.isError ? { failed: true, errorType: cachedMetadata.errorType || 'other' } : { failed: false };

        return {
            rawFileName, fileName: cleanedFileName, title: cleanedMovieName,
            position: convertTimeToSec(currentTime), duration: convertTimeToSec(totalTime),
            isPlaying: /<p id="state">2<\/p>/.test(data),
            isPaused: /<p id="state">1<\/p>/.test(data),
            isStopped: /<p id="state">(?:0|-1)<\/p>/.test(data),
            tmdbID: ids.tmdbID, groupID: ids.groupID, malID: ids.malID,
            debugIds, isFallback, filePath, ffprobeStatus,
            playerAppearance
        };
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') return { isOffline: true };
        return { isOffline: false, isError: true, errorMessage: error.message, errorCode: error.code || 'UNKNOWN' };
    }
};

module.exports = { getMpcStatus, resetMpcCache, refreshTxtMetadata, DEFAULT_PLAYER_APPEARANCE };
