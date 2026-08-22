// logger.js
const { execSync } = require('child_process');

let updateEventCount = 0;
let lastLoggedState = null;
let mpcOfflineLogged = false;

function deepClearConsole() {
    try {
        if (process.platform === 'linux') {
            process.stdout.write('\x1b_Ga=d\x1b\\');
            execSync('clear', { stdio: 'inherit' });
        } else if (process.platform === 'win32') {
            process.stdout.write('\x1Bc');
        } else {
            console.clear();
        }
    } catch (e) {
        console.clear();
    }
}

function checkClearConsole() {
    if (updateEventCount >= 10) {
        deepClearConsole();
        console.log('🧹 Console auto-cleared (10 update limit reached)...');
        updateEventCount = 0;
    }
    updateEventCount++;
}

function statusLine(label, icon, message) {
    const paddedLabel = label.padEnd(18, ' ');
    return `   - ${paddedLabel}: ${icon} ${message}`;
}

function detailLine(label, message) {
    const paddedLabel = label.padEnd(18, ' ');
    return `     ${paddedLabel}: ${message}`;
}

function buildYearStr(year) {
    return year ? ` (year: ${year})` : '';
}

function isRetryNote(msg) {
    return msg.startsWith('Strict year match failed.') ||
           msg.startsWith('No results for ');
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function logReady(clientId) {
    deepClearConsole();
    console.log(`✅ Connected to Discord (RPC Ready) — clientId: ${clientId}`);
}

function logOffline() {
    if (!mpcOfflineLogged) {
        deepClearConsole();
        console.log('⏳ MPC-HC is closed or not running. Waiting for player...');
        mpcOfflineLogged = true;
        updateEventCount = 0;
        lastLoggedState = null;
    }
}

function resetOfflineStatus() {
    mpcOfflineLogged = false;
}

function logMpcError(errorCode, errorMessage) {
    console.log(`\n❌ [MPC-HC ERROR] Unexpected error while contacting MPC-HC web interface`);
    console.log(`   Code    : ${errorCode || 'UNKNOWN'}`);
    console.log(`   Message : ${errorMessage || '(no message)'}`);
    console.log(`   💡 Tip: Check that the Web Interface port (13579) isn't blocked or used by another app.`);
}

function logNewMedia(mpcStatus, activityPayload, debugData, config) {
    checkClearConsole();

    const isGroup = !!mpcStatus.groupID;
    const sourceInfo = debugData.cachedPosterSource || 'Not Found';
    const isCache = sourceInfo.includes('[CACHE]');
    const cleanSource = sourceInfo.replace('[CACHE] ', '');

    const allSearchNotes = safeArray(debugData.cachedPosterDebug?.apiErrors);
    const retryNotes = allSearchNotes.filter(isRetryNote);
    const apiErrors = allSearchNotes.filter(msg => !isRetryNote(msg));
    const txtTmdb = mpcStatus.debugIds?.txt?.tmdb || null;
    const txtGroup = mpcStatus.debugIds?.txt?.group || null;
    const txtMal = mpcStatus.debugIds?.txt?.mal || null;

    const showTitle = debugData.showTitle || null;
    const titleSourceDebug = debugData.titleSourceDebug || 'none';
    const cachedEpisodeTitle = debugData.cachedApiEpisodeTitle || null;
    const fetchedEpisodeTitle = debugData.fetchedEpisodeTitle || null;
    const cachedFetchedTitles = debugData.cachedFetchedTitles?.debugInfo || null;

    const hasOverride = !!(
        config.customText ||
        config.customBigText ||
        debugData.customImageURL ||
        config.tmdb_id
    );

    console.log(`\n${'═'.repeat(64)}`);
    console.log(`🎬 NEW MEDIA DETECTED`);
    console.log(`${'═'.repeat(64)}`);
    console.log(`   Playback state      : ${mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED')}`);
    console.log(`   Raw file            : ${mpcStatus.rawFileName || '—'}`);
    console.log(`   Clean/display file  : ${mpcStatus.fileName || '—'}`);
    console.log(`${'═'.repeat(64)}`);

    // ─────────────────────────────────────────────────────────────────────
    // CONFIG OVERRIDES
    // ─────────────────────────────────────────────────────────────────────
    if (hasOverride) {
        console.log(`\n⚙️  [CONFIG OVERRIDES ACTIVE]`);
        if (config.customText) {
            console.log(statusLine('customText', '✏️', `"${config.customText}"`));
        }
        if (config.customBigText) {
            console.log(statusLine('customBigText', '✏️', `"${config.customBigText}"`));
        }
        if (debugData.customImageURL) {
            console.log(statusLine('customImage', '🖼️', `Custom image active (${debugData.posterCount || '?'} poster fetch skipped if applicable)`));
        }
        if (config.tmdb_id) {
            console.log(statusLine('tmdb_id', '🔧', `Manual TMDb override = ${config.tmdb_id}`));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. RAW INPUT & ID RESOLUTION
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`📦 [1. RAW INPUT & ID RESOLUTION]`);
    console.log(`${'─'.repeat(64)}`);


    console.log(statusLine(
        'Filename',
        '📄',
        `"${mpcStatus.rawFileName || '—'}"`
    ));
    console.log(statusLine(
        'Clean filename',
        '🧹',
        `"${mpcStatus.fileName || '—'}"`
    ));
    console.log(statusLine(
        'Order mode',
        isGroup ? '👥' : '📺',
        isGroup ? 'TMDb Episode Group (absolute order)' : 'TMDb season order'
    ));
    console.log(statusLine(
        'MPC file path',
        '📂',
        mpcStatus.filePath || 'Not available'
    ));

    const ffprobeStatus = mpcStatus.ffprobeStatus || { failed: false };

    if (ffprobeStatus.failed && ffprobeStatus.errorType === 'timeout') {
        console.log(statusLine('FFprobe', '⏱️', 'Timed out after 3s → filename remains the input'));
        console.log(detailLine('Failure point', 'FFprobe did not return metadata within the timeout.'));
    } else if (ffprobeStatus.failed && ffprobeStatus.errorType === 'not_installed') {
        console.log(statusLine('FFprobe', '❌', 'Not found in PATH → filename fallback'));
        console.log(detailLine('Failure point', 'ffprobe executable is unavailable.'));
    } else if (ffprobeStatus.failed) {
        console.log(statusLine('FFprobe', '⚠️', 'Failed to read title tag → filename fallback'));
        console.log(detailLine('Failure point', 'FFprobe returned an error while reading the file.'));
    } else if (!mpcStatus.isFallback && mpcStatus.title) {
        console.log(statusLine('FFprobe', '✅', `Embedded title found: "${mpcStatus.title}"`));
    } else {
        console.log(statusLine('FFprobe', '—', 'No embedded title tag → filename remains the input'));
    }

    if (txtTmdb || txtGroup || txtMal) {
        const found = [];
        if (txtTmdb) found.push(`TMDb=${txtTmdb}`);
        if (txtGroup) found.push(`Group=${txtGroup}`);
        if (txtMal) {
            const malState = (txtMal && debugData.anilistMatchMode === 'mal.txt') ? 'used' :
                (config.romajiTitle ? 'present' : 'present, romajiTitle OFF');
            found.push(`MAL=${txtMal} (${malState})`);
        }
        console.log(statusLine('Folder TXT', '✅', found.join(' · ')));
    } else if (mpcStatus.filePath) {
        console.log(statusLine('Folder TXT', '—', 'No tmdb.txt / group.txt / mal.txt found'));
    } else {
        console.log(statusLine('Folder TXT', '—', 'Folder path unavailable'));
    }

    const finalTmdb = mpcStatus.tmdbID || '—';
    const finalGroup = mpcStatus.groupID || '—';

    console.log(statusLine('Final TMDb ID', finalTmdb !== '—' ? '✅' : '—', finalTmdb));
    console.log(statusLine('Final Group ID', finalGroup !== '—' ? '✅' : '—', finalGroup));
    console.log(statusLine('ID source', '🔎', debugData.idSource || 'Not Found'));

    if (!mpcStatus.tmdbID && !config.tmdb_id && !txtTmdb) {
        console.log(detailLine(
            'ID resolution',
            'No explicit TMDb ID was supplied → next step is filename search.'
        ));
    }

    // Episode parser is part of input resolution because it determines which
    // TMDb season/episode data and AniList date are relevant later.
    console.log(`\n   ├─ Episode parser`);
    const parsedEpisode = cachedFetchedTitles?.parsedEpisode;
    const titlesFile = cachedFetchedTitles?.titlesFile;
    const loadedCount = cachedFetchedTitles?.loadedCount ?? 0;
    const forcedSeason = debugData.cachedFetchedTitles?.forcedSeason ?? null;

    console.log(statusLine('Parsed episode', parsedEpisode ? '✅' : '⚠️', parsedEpisode ?? 'Not detected'));
    console.log(statusLine('Titles file', titlesFile ? '✅' : '—', titlesFile || 'None'));
    console.log(statusLine('Loaded title count', loadedCount > 0 ? '✅' : '—', String(loadedCount)));
    console.log(statusLine('Forced season', forcedSeason !== null && forcedSeason !== undefined ? '✅' : '—', forcedSeason ?? 'None'));

    // ─────────────────────────────────────────────────────────────────────
    // 2. POSTER / METADATA FETCH & CACHE
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`📡 [2. POSTER FETCH & CACHE]`);
    console.log(`${'─'.repeat(64)}`);


    if (debugData.customImageURL) {
        console.log(statusLine('Method', '🖼️', 'Custom image active → TMDb poster fetch is intentionally skipped'));
        console.log(detailLine('Why no poster fetch', 'customImage overrides the poster path.'));
    } else if (!config.autoPoster) {
        console.log(statusLine('Method', '—', 'autoPoster is OFF → poster/show-title metadata is intentionally skipped'));
        console.log(detailLine('Why no poster fetch', 'autoPoster is disabled by config.'));
    } else if (isCache) {
        console.log(statusLine('Metadata source', '📂', `Local cache hit → ${cleanSource}`));
        console.log(statusLine('API request', '⚡', 'No new TMDb metadata request for this cached entry'));
    } else if (posterOk) {
        console.log(statusLine('Metadata source', '🌐', `Fresh API result → ${cleanSource}`));
        console.log(statusLine('API request', '✅', 'TMDb metadata fetch succeeded'));
    } else {
        console.log(statusLine('Metadata source', '❌', cleanSource));
    }

    if (debugData.cachedPosterDebug) {
        const d = debugData.cachedPosterDebug;

        if (d.cleanTitle) {
            console.log(statusLine('Search query', '🔍', `"${d.cleanTitle}"${buildYearStr(d.year)}`));
        } else if (d.searchedTmdb) {
            console.log(statusLine('Search query', '🔍', 'Attempted, but cleaned title was empty'));
            console.log(detailLine('Failure point', 'Filename cleaning produced no usable TMDb search title.'));
        }

        console.log(statusLine('Search performed', d.searchedTmdb ? '✅' : '—', d.searchedTmdb ? 'Yes' : 'No'));

        if (retryNotes.length > 0) {
            console.log(statusLine('Search retries', '🔁', `${retryNotes.length} retry note(s)`));
            retryNotes.forEach(msg => console.log(`     ↳ ${msg}`));
        } else if (d.searchedTmdb) {
            console.log(statusLine('Search retries', '—', 'No retry notes'));
        }

        if (apiErrors.length > 0) {
            console.log(statusLine('API / resolver errors', '❌', `${apiErrors.length} real error(s)`));
            apiErrors.forEach(msg => console.log(`     ↳ ${msg}`));
        } else {
            console.log(statusLine('API / resolver errors', '✅', 'None reported'));
        }
    }

    if (txtMal) {
        if (debugData.anilistMatchMode === 'mal.txt') {
            console.log(statusLine('AniList resolver', '🎯', `MAL ID ${txtMal} from mal.txt used as absolute match`));
        } else if (!config.romajiTitle) {
            console.log(statusLine('AniList resolver', '—', `mal.txt present (MAL ${txtMal}) but romajiTitle is OFF`));
        } else if (debugData.anilistMatchMode === 'date-exact' || titleSourceDebug === 'anilist') {
            console.log(statusLine('AniList resolver', '🔎', `mal.txt present (MAL ${txtMal}), but current result came from exact-date resolver`));
        } else {
            console.log(statusLine('AniList resolver', '⚠️', `mal.txt present (MAL ${txtMal}) but was not used`));
        }
    }

    if (debugData.showTitle) {
        console.log(statusLine(
            'Show title',
            titleSourceDebug === 'anilist' ? '🌐' : '🏷️',
            `"${debugData.showTitle}" (${titleSourceDebug})`
        ));
    } else if (config.autoPoster) {
        console.log(statusLine('Show title', '⚠️', 'No show title resolved'));
        console.log(detailLine(
            'Failure point',
            'Metadata lookup did not provide a displayable show title.'
        ));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. TITLE & EPISODE RESOLUTION
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`🍳 [3. TITLE & EPISODE RESOLUTION]`);
    console.log(`${'─'.repeat(64)}`);


    console.log(statusLine(
        'Show title result',
        showTitle ? '✅' : '⚠️',
        showTitle ? `"${showTitle}"` : 'Not resolved'
    ));

    if (showTitle) {
        let titleExplanation = 'TMDb standard title';
        if (titleSourceDebug === 'anilist') {
            titleExplanation = 'AniList season-specific title selected';
        } else if (titleSourceDebug === 'tmdb alt') {
            titleExplanation = 'TMDb alternative/Romaji title selected';
        }
        console.log(detailLine('Title decision', titleExplanation));
    } else if (config.autoPoster) {
        console.log(detailLine('Title decision', 'No show title available from metadata.'));
    }

    console.log(statusLine(
        'Clickable media URL',
        debugData.mediaUrl ? '🔗' : '—',
        debugData.mediaUrl || 'None'
    ));

    if (titleSourceDebug === 'anilist' && !debugData.mediaUrl) {
        console.log(detailLine(
            'URL warning',
            'AniList title resolved, but no MAL URL was returned (idMal unavailable).'
        ));
    }

    if (fetchedEpisodeTitle) {
        const srcFile = titlesFile || 'titles.txt';
        console.log(statusLine('Episode title', '✅', `"${fetchedEpisodeTitle}" (local ${srcFile})`));
        console.log(detailLine('Episode decision', 'Local titles file matched the parsed episode number.'));
    } else if (cachedEpisodeTitle) {
        console.log(statusLine('Episode title', '✅', `"${cachedEpisodeTitle}" (TMDb API/cache)`));
        console.log(detailLine('Episode decision', 'No local episode-title match was used; TMDb episode metadata supplied the title.'));
    } else if (!config.autoEpisode) {
        console.log(statusLine('Episode title', '—', 'autoEpisode is OFF'));
        console.log(detailLine('Failure point', 'TMDb episode lookup is disabled by config.'));
    } else if (loadedCount > 0) {
        console.log(statusLine('Episode title', '⚠️', 'titles file loaded, but current episode did not match'));
        if (parsedEpisode) {
            console.log(detailLine(
                'Failure point',
                `Parsed episode ${parsedEpisode}, but that episode number was not found in ${titlesFile || 'titles.txt'}.`
            ));
        } else {
            console.log(detailLine(
                'Failure point',
                `The titles file was read, but no episode number could be extracted from the filename.`
            ));
        }
    } else if (!parsedEpisode) {
        console.log(statusLine('Episode title', '⚠️', 'No episode number detected'));
        console.log(detailLine(
            'Failure point',
            'Episode parser could not determine which episode to request.'
        ));
    } else if (mpcStatus.tmdbID || config.tmdb_id || cleanSource !== 'Not Found') {
        console.log(statusLine('Episode title', '⚠️', `Episode ${parsedEpisode} has no usable TMDb episode title`));
        console.log(detailLine(
            'Failure point',
            'A media entry was found, but the fetched/cached episode list did not contain usable data for this episode.'
        ));
    } else {
        console.log(statusLine('Episode title', '—', 'Unavailable'));
        console.log(detailLine(
            'Failure point',
            'No TMDb media ID/result and no local titles file were available.'
        ));
    }

    console.log(statusLine('Image decision', '🖼️', debugData.imageSource || 'Not provided'));
    console.log(statusLine('Large text decision', '📝', debugData.bigTextSource || 'Not provided'));

    // ─────────────────────────────────────────────────────────────────────
    // 4. FINAL DISCORD PAYLOAD
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`🚀 [4. FINAL DISCORD PAYLOAD]`);
    console.log(`${'─'.repeat(64)}`);


    console.log(statusLine('Payload name', activityPayload?.name ? '✅' : '—', activityPayload?.name || 'Not set'));
    console.log(statusLine('Payload details', activityPayload?.details ? '✅' : '—', activityPayload?.details || 'Not set'));
    console.log(statusLine('Payload state', activityPayload?.state ? '✅' : '—', activityPayload?.state || 'Not set'));
    console.log(statusLine('Large image key', activityPayload?.largeImageKey ? '✅' : '⚠️', activityPayload?.largeImageKey || 'Not set'));
    console.log(statusLine('Large image text', activityPayload?.largeImageText ? '✅' : '—', activityPayload?.largeImageText || 'Not set'));
    console.log(statusLine('Small image key', activityPayload?.smallImageKey ? '✅' : '—', activityPayload?.smallImageKey || 'Not set'));
    console.log(statusLine('Small image text', activityPayload?.smallImageText ? '✅' : '—', activityPayload?.smallImageText || 'Not set'));
    console.log(statusLine('Start timestamp', activityPayload?.startTimestamp ? '✅' : '—', activityPayload?.startTimestamp ?? 'Not set'));
    console.log(statusLine('End timestamp', activityPayload?.endTimestamp ? '✅' : '—', activityPayload?.endTimestamp ?? 'Not set'));
    console.log(statusLine('Details URL', activityPayload?.detailsUrl ? '🔗' : '—', activityPayload?.detailsUrl || 'None'));

    console.log(`${'═'.repeat(64)}\n`);

    lastLoggedState = mpcStatus.isPlaying
        ? 'PLAYING'
        : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');
}

function logStateUpdate(currentMediaState, activityPayload) {
    if (currentMediaState !== lastLoggedState) {
        checkClearConsole();

        console.log(`\n${'─'.repeat(64)}`);
        console.log(`⏯️  [STATE CHANGE] → ${currentMediaState}`);
        console.log(`${'─'.repeat(64)}`);

        console.log(statusLine('Name', '🏷️', activityPayload?.name || 'Not set'));
        console.log(statusLine('Details', '📌', activityPayload?.details || 'Not set'));
        console.log(statusLine('State', '🎞️', activityPayload?.state || 'Not set'));
        console.log(statusLine('Small text', 'ℹ️', activityPayload?.smallImageText || 'Not set'));
        console.log(statusLine('Large image', '🖼️', activityPayload?.largeImageKey || 'Not set'));
        console.log(statusLine('Large text', '📝', activityPayload?.largeImageText || 'Not set'));
        console.log(statusLine('Details URL', '🔗', activityPayload?.detailsUrl || 'None'));

        console.log(`${'─'.repeat(64)}\n`);

        lastLoggedState = currentMediaState;
    }
}

function logConfigChanged(changedKeys, isApiChange) {
    console.log(`\n🔄 [LIVE CONFIG] Change detected from menu.js`);

    if (changedKeys && changedKeys.length > 0) {
        console.log(`   Changed keys       : ${changedKeys.join(', ')}`);
    } else {
        console.log(`   Changed keys       : Unknown`);
    }

    if (isApiChange) {
        console.log(`   Result             : ⚙️  API-affecting config → metadata/cache will be refreshed`);
    } else {
        console.log(`   Result             : 🎨 Display-only config → current metadata can be reused`);
    }
}

function logTxtWatcherEvent(filename) {
    console.log(`\n🔄 [TXT WATCHER] "${filename}" changed`);
    console.log(`   Result             : Folder metadata will be reloaded before the next presence update.`);
}

function logDiscordWaiting() {
    console.log('⏳ Waiting for Discord... (will connect automatically when Discord opens)');
}

function logDiscordDisconnected() {
    console.log('\n⚠️  Disconnected from Discord! Waiting for Discord to reopen...');
}

module.exports = {
    logReady,
    logOffline,
    resetOfflineStatus,
    logNewMedia,
    logStateUpdate,
    logMpcError,
    logConfigChanged,
    logTxtWatcherEvent,
    logDiscordWaiting,
    logDiscordDisconnected,
};
