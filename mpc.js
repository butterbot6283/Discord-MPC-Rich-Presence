const axios = require('axios');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);
const { fetchIdsFromTxt } = require('./metadata');
const { cleanName } = require('./utils');

let lastFilePath = null;
let cachedMetadata = null;

const resetMpcCache = () => { lastFilePath = null; cachedMetadata = null; };

const getMpcStatus = async (config) => {
    try {
        const response = await axios.get('http://127.0.0.1:13579/variables.html');
        const data = response.data;
        const fileNameMatch = data.match(/<p id="file">(.+?)<\/p>/);
        let rawFileName = fileNameMatch ? fileNameMatch[1].trim() : 'Unknown File';
        const cleanedFileName = cleanName(rawFileName, config);
        const filePathMatch = data.match(/<p id="filepath">(.+?)<\/p>/);
        const filePath = filePathMatch ? decodeURIComponent(filePathMatch[1].trim()) : null;

        let ids = { tmdbID: null, groupID: null, malID: null };
        let debugIds = { txt: { tmdb: null, group: null, mal: null }, config: { tmdb: config.tmdb_id } };
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
            const txtIds = fetchIdsFromTxt(videoDir);
            if (txtIds.tmdbID) ids.tmdbID = txtIds.tmdbID;
            ids.groupID = txtIds.groupID || null;
            ids.malID = txtIds.malID || null;
            debugIds.txt = { tmdb: txtIds.tmdbID, group: txtIds.groupID, mal: txtIds.malID };

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
            isStopped: /<p id="state">-1<\/p>/.test(data),
            tmdbID: ids.tmdbID, groupID: ids.groupID, malID: ids.malID,
            debugIds, isFallback, filePath, ffprobeStatus
        };
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') return { isOffline: true };
        return { isOffline: false, isError: true, errorMessage: error.message, errorCode: error.code || 'UNKNOWN' };
    }
};

module.exports = { getMpcStatus, resetMpcCache };
