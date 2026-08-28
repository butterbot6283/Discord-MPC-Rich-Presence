// payload.js
const { formatTime, getFallbackName } = require('./utils');

let idleStartTimestamp = null;
let pausedStartTimestamp = null;
let pausedEndTimestamp = null;

function buildPayload(mpcStatus, showTitle, fetchedEpisodeTitle, fetchedReleaseDate, largeImageKey, config, tmdbUrl, mediaType) {
    const playerAppearance = mpcStatus.playerAppearance || { name: 'MPC-HC', largeImageKey: 'https://i.imgur.com/MwZqLN8.png' };

    if (mpcStatus.isStopped) {
        pausedStartTimestamp = null;
        pausedEndTimestamp = null;

        if (idleStartTimestamp === null) {
            idleStartTimestamp = Date.now();
        }

        return {
            details: playerAppearance.name,
            state: 'Nothing is playing',
            type: 0,
            startTimestamp: idleStartTimestamp,
            smallImageKey: "https://imgur.com/DhYzyGS.png",
            smallImageText: "Idle",
            largeImageKey: playerAppearance.largeImageKey,
            largeImageText: playerAppearance.name,
        };
    }

    idleStartTimestamp = null;
	const useMetadataTitle = (mediaType !== 'movie');
	const mediaTitleOrFile = (useMetadataTitle && !mpcStatus.isFallback && mpcStatus.title) 
        ? mpcStatus.title 
        : mpcStatus.fileName;

    let stateText;
    if (mpcStatus.isPlaying) {
        pausedStartTimestamp = null;
        pausedEndTimestamp = null;

        if (fetchedEpisodeTitle) stateText = fetchedEpisodeTitle;
        else if (useMetadataTitle && !mpcStatus.isFallback && mpcStatus.title && mpcStatus.title !== mpcStatus.fileName) stateText = mpcStatus.title;
        else if (showTitle) stateText = mpcStatus.fileName;
        else stateText = getFallbackName(mpcStatus.rawFileName);
    } else {
        stateText = `${formatTime(mpcStatus.position)} / ${formatTime(mpcStatus.duration)}`;
    }

    let largeImageText;
    if (mpcStatus.isPaused && !showTitle && fetchedEpisodeTitle) largeImageText = fetchedEpisodeTitle;
    else largeImageText = config.customBigText?.trim()
        ? config.customBigText
        : (fetchedReleaseDate ? `(${fetchedReleaseDate})` : playerAppearance.name);

    let startTimestamp;
    let endTimestamp;

    if (mpcStatus.isPaused) {
        if (pausedStartTimestamp === null) {
            pausedStartTimestamp = Date.now() - (mpcStatus.position * 1000);
            pausedEndTimestamp = pausedStartTimestamp + (mpcStatus.position * 1000);
        }

        startTimestamp = pausedStartTimestamp;
        endTimestamp = pausedEndTimestamp;
    } else {
        startTimestamp = Date.now() - (mpcStatus.position * 1000);
        endTimestamp = startTimestamp + (mpcStatus.duration * 1000);
    }

    let nameText, detailsText, statusType;
    if (mpcStatus.isPlaying) {
        nameText = undefined;
        detailsText = showTitle || mpcStatus.fileName;
        statusType = showTitle ? 2 : undefined;
    } else {
        if (showTitle) {
            nameText = showTitle;
            detailsText = fetchedEpisodeTitle || mediaTitleOrFile;
            statusType = 0;
        } else if (fetchedEpisodeTitle) {
            nameText = undefined;
            detailsText = mpcStatus.fileName;
            statusType = 0;
            largeImageText = fetchedEpisodeTitle;
        } else {
            nameText = undefined;
            detailsText = mpcStatus.fileName;
            statusType = 0;
        }
    }

    const payload = {
        name: nameText,
        details: detailsText,
        state: stateText,
        startTimestamp,
        endTimestamp,
        type: 3,
        statusDisplayType: statusType,
        smallImageKey: mpcStatus.isPlaying
        ? "https://i.imgur.com/8IYhOc2.png"
        : "https://i.imgur.com/CCg9fxf.png",
        smallImageText: mpcStatus.isPlaying ? "Playing" : "Paused",
        largeImageKey,
        largeImageText: largeImageText || mediaTitleOrFile,
    };

    if (mpcStatus.isPlaying && tmdbUrl) {
        if (showTitle && detailsText === showTitle) {
            payload.detailsUrl = tmdbUrl;
        }
    }

    return payload;
}

module.exports = { buildPayload };
