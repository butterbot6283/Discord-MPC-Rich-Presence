// payload.js
const { formatTime, getFallbackName } = require('./utils');

// Persistent timestamp for the Stopped/Idle state.
// Reused on every presence refresh so Discord's elapsed timer does not reset.
let idleStartTimestamp = null;

function buildPayload(mpcStatus, showTitle, fetchedEpisodeTitle, fetchedReleaseDate, largeImageKey, config, tmdbUrl) {
    if (mpcStatus.isStopped) {
        if (idleStartTimestamp === null) {
            idleStartTimestamp = Date.now();
        }

        return {
            details: 'Idling',
            state: 'Nothing is playing',
            type: 0,
            startTimestamp: idleStartTimestamp,
            smallImageKey: "https://imgur.com/DhYzyGS.png",
            smallImageText: "Idle",
            largeImageKey: "https://i.imgur.com/MwZqLN8.png",
            largeImageText: 'Media Player Classic',
        };
    }

    // Leaving Stopped/Idle: start a fresh idle timer next time playback stops.
    idleStartTimestamp = null;

    let stateText;
    if (mpcStatus.isPlaying) {
        if (fetchedEpisodeTitle) stateText = fetchedEpisodeTitle;
        else if (!mpcStatus.isFallback && mpcStatus.title && mpcStatus.title !== mpcStatus.fileName) stateText = mpcStatus.title;
        else if (showTitle) stateText = mpcStatus.fileName;
        else stateText = getFallbackName(mpcStatus.rawFileName);
    } else {
        stateText = `${formatTime(mpcStatus.position)} / ${formatTime(mpcStatus.duration)}`;
    }

    let largeImageText;
    if (mpcStatus.isPaused && !showTitle && fetchedEpisodeTitle) largeImageText = fetchedEpisodeTitle;
    else largeImageText = config.customBigText?.trim()
        ? config.customBigText
        : (fetchedReleaseDate ? `(${fetchedReleaseDate})` : 'MPC-HC');

    const startTimestamp = Date.now() - (mpcStatus.position * 1000);
    const endTimestamp = mpcStatus.isPlaying
        ? startTimestamp + (mpcStatus.duration * 1000)
        : startTimestamp + (mpcStatus.position * 1000);

    let nameText, detailsText, statusType;
    if (mpcStatus.isPlaying) {
        nameText = undefined;
        detailsText = showTitle || mpcStatus.fileName;
        statusType = showTitle ? 2 : undefined;
    } else {
        if (showTitle) {
            nameText = showTitle;
            detailsText = fetchedEpisodeTitle || (!mpcStatus.isFallback ? mpcStatus.title : mpcStatus.fileName);
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
        largeImageText: largeImageText || mpcStatus.title,
    };

    // Clickable media URL
    if (mpcStatus.isPlaying && tmdbUrl) {
        if (showTitle && detailsText === showTitle) {
            payload.detailsUrl = tmdbUrl;
        }
    }

    return payload;
}

module.exports = { buildPayload };
