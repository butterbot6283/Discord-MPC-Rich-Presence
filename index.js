const RPC = require('@xhayper/discord-rpc');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fetchPoster = require('./poster');
const { fetchTitles, fetchIdsFromTxt } = require('./titles');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let config = {};
const configPath = path.join(__dirname, 'config.json');

const mpcId = '1298018501814128796';
const createClient = () => new RPC.Client({ clientId: mpcId });
let client = createClient();
let lastPlaybackState = 'offline';
let presenceInterval = null;

// ==========================================
// VARIABLE TRACKING & CLEAN LOGGING SYSTEM
// ==========================================
let updateEventCount = 0; // Menghitung jumlah event/update, bukan baris teks
let lastLoggedFileName = null;
let lastLoggedState = null;
let mpcOfflineLogged = false;

// Fungsi sapu jagat untuk mengatasi gambar terminal Linux (fastfetch/sixel/kitty)
function deepClearConsole() {
    try {
        if (process.platform === 'linux') {
            // 1. Tembakkan escape code Kitty Image Protocol (mematikan gambar yang melayang)
            process.stdout.write('\x1b_Ga=d\x1b\\');
            // 2. Eksekusi perintah 'clear' bawaan Linux agar bersih sampai ke akar
            execSync('clear', { stdio: 'inherit' });
        } else {
            console.clear();
        }
    } catch (e) {
        console.clear(); // Fallback jika gagal
    }
}

// Cek dan bersihkan console SEBELUM nge-print log baru
function checkClearConsole() {
    if (updateEventCount >= 10) {
        deepClearConsole();
        console.log("🧹 Console dibersihkan otomatis...");
        updateEventCount = 0;
    }
    updateEventCount++;
}

const reloadConfig = () => {
    try {
        if (fs.existsSync(configPath)) {
            const fileData = fs.readFileSync(configPath, 'utf-8');
            config = JSON.parse(fileData);
        }
    } catch (e) {
        console.error("Kesalahan membaca config.json:", e.message);
    }
};
// Panggil sekali di awal untuk memuat config pertama kali
reloadConfig();
setInterval(reloadConfig, 15000);

function cleanName(name, isMovieName = false) {
    let cleanedName = name;
    if (!isMovieName && config.cleanFilename !== false) {
        cleanedName = cleanedName.replace(/\[.*?\]/g, '');
        if (Array.isArray(config.cleanRegex) && config.cleanRegex.length > 0) {
            config.cleanRegex.forEach(regex => {
                try {
                    const re = new RegExp(regex, 'gi');
                    cleanedName = cleanedName.replace(re, '');
                } catch (err) {}
            });
        }
    }
    cleanedName = cleanedName
    .replace(/\.{2,}/g, '.')
    .replace(/\s+\.(mkv|mp4|avi|flv)/, '.$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
    return cleanedName;
}

const getFallbackName = (filePath) => {
    const extensionMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toUpperCase() : 'unknown';
    return `${extension} Video`;
};

let lastFilePath = null;
let cachedMetadata = null;
let currentImageIndex = 0;

const getCustomImage = () => {
    if (Array.isArray(config.customImage) && config.customImage.some(image => image.trim())) {
        let image = config.customImage[currentImageIndex].trim() || null;
        currentImageIndex = (currentImageIndex + 1) % config.customImage.length;
        return image;
    }
    return null;
};
let customImageURL = getCustomImage();
setInterval(() => { customImageURL = getCustomImage(); }, 60000);
const getCustomBigText = () => config.customBigText.trim() || null;

let cleanedFileName = '';
const getMpcStatus = async () => {
    try {
        const response = await axios.get('http://127.0.0.1:13579/variables.html');
        const data = response.data;

        const fileNameMatch = data.match(/<p id="file">(.+?)<\/p>/);
        let rawFileName = fileNameMatch ? fileNameMatch[1].trim() : 'Unknown File';
        cleanedFileName = cleanName(rawFileName);

        const filePathMatch = data.match(/<p id="filepath">(.+?)<\/p>/);
        const filePath = filePathMatch ? decodeURIComponent(filePathMatch[1].trim()) : null;

        let ids = { imdbID: null, malID: null };
        let debugIds = { metadata: {imdb: null, mal: null}, txt: {imdb: null, mal: null}, config: {imdb: config.imdb_id, mal: config.mal_id} };

        let releaseDate = null;
        let movieName = null;
        let isFallback = false;

        if (filePath) {
            if (filePath !== lastFilePath || !cachedMetadata) {
                await new Promise((resolve) => {
                    ffmpeg.ffprobe(filePath, (err, metadata) => {
                        if (err) {
                            cachedMetadata = { isError: true };
                            lastFilePath = filePath;
                            return resolve();
                        }
                        const tags = metadata.format.tags || {};
                        cachedMetadata = {
                            metaTitle: tags.title,
                            imdbID: tags.IMDB_ID || null,
                            malID: tags.MAL_ID || null,
                            releaseDate: tags.DATE_RELEASED || null,
                            isError: false
                        };
                        lastFilePath = filePath;
                        resolve();
                    });
                });
            }

            if (cachedMetadata && !cachedMetadata.isError) {
                ids = { imdbID: cachedMetadata.imdbID, malID: cachedMetadata.malID };
                debugIds.metadata = { imdb: ids.imdbID, mal: ids.malID };
            }
            if (!ids.imdbID || !ids.malID) {
                const videoDir = path.dirname(filePath);
                const txtIds = fetchIdsFromTxt(videoDir);
                if (txtIds.imdbID && !ids.imdbID) ids.imdbID = txtIds.imdbID;
                if (txtIds.malID && !ids.malID) ids.malID = txtIds.malID;
                debugIds.txt = { imdb: txtIds.imdbID, mal: txtIds.malID };
            }
            if (!ids.imdbID) ids.imdbID = config.imdb_id.trim() || null;
            if (!ids.malID) ids.malID = config.mal_id.trim() || null;

            const metaTitle = cachedMetadata && !cachedMetadata.isError ? cachedMetadata.metaTitle : null;
            releaseDate = cachedMetadata && !cachedMetadata.isError ? cachedMetadata.releaseDate : null;

            if (config.customText && config.customText.trim()) movieName = config.customText;
            else if (metaTitle && metaTitle.length <= 128) movieName = metaTitle;
            else { movieName = cleanedFileName; isFallback = true; }
        } else {
            movieName = cleanedFileName; isFallback = true;
            ids = { imdbID: config.imdb_id.trim() || null, malID: config.mal_id.trim() || null };
        }

        const cleanedMovieName = cleanName(movieName);
        const currentTimeMatch = data.match(/(\d{2}:\d{2}:\d{2})/g);
        const currentTime = currentTimeMatch ? currentTimeMatch[0] : '00:00:00';
        const totalTime = currentTimeMatch ? currentTimeMatch[1] : '00:00:00';

        const isPlaying = /<p id="state">2<\/p>/.test(data);
        const isPaused = /<p id="state">1<\/p>/.test(data);
        const isStopped = /<p id="state">-1<\/p>/.test(data);

        return {
            rawFileName,
            fileName: cleanedFileName,
            title: cleanedMovieName,
            position: convertTimeToSeconds(currentTime),
            duration: convertTimeToSeconds(totalTime),
            isPlaying, isPaused, isStopped,
            bigText: releaseDate || getCustomBigText(),
            imdbID: ids.imdbID, malID: ids.malID,
            debugIds, releaseDate, isFallback, filePath
        };
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
            return { isOffline: true };
        }
        return null;
    }
};

let cachedPoster = null, cachedShowTitle = null, lastFetchedFileName = null;
let lastImdbId = null, lastMalId = null, lastConfigImdbId = null, lastConfigMalId = null, lastAutoPoster = config.autoPoster;
let lastFetchedTitlesFileName = null, cachedFetchedTitles = null;

const resetAllCaches = () => {
    cachedMetadata = null; lastFilePath = null; cachedFetchedTitles = null;
    lastFetchedTitlesFileName = null; cachedPoster = null; cachedShowTitle = null;
    lastFetchedFileName = null; lastImdbId = null; lastMalId = null;
    lastConfigImdbId = null; lastConfigMalId = null; lastAutoPoster = null;
};

async function updatePresence(mpcStatus) {
    if (!mpcStatus) return;

    let showTitle = null;
    let largeImageKey = customImageURL ? customImageURL : 'https://i.imgur.com/MwZqLN8.png';
    let episodeTitle = mpcStatus.title;
    let releaseDate = mpcStatus.releaseDate || '';

    const isNewMedia = (mpcStatus.rawFileName !== lastFetchedTitlesFileName);
    let fetchedEpisodeTitle = null;
    let fetchedReleaseDate = null;

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

    if (fetchedEpisodeTitle && !mpcStatus.title.toLowerCase().startsWith('episode') && !/^S\d{2}E\d{2}/i.test(mpcStatus.title)) {
        episodeTitle = fetchedEpisodeTitle;
        releaseDate = fetchedReleaseDate || releaseDate;
    }

    const needsFetch = isNewMedia || mpcStatus.imdbID !== lastImdbId || mpcStatus.malID !== lastMalId ||
    config.imdb_id !== lastConfigImdbId || config.mal_id !== lastConfigMalId || config.autoPoster !== lastAutoPoster;

    if (needsFetch && (mpcStatus.imdbID || mpcStatus.malID || config.imdb_id || config.mal_id || config.autoPoster)) {
        const result = await fetchPoster(mpcStatus.imdbID, mpcStatus.malID, cleanName(mpcStatus.rawFileName));
        if (!result.retry) {
            if (result.showTitle) showTitle = result.showTitle;
            if (!customImageURL) largeImageKey = result.poster || largeImageKey;

            cachedPoster = result.poster;
            cachedShowTitle = result.showTitle;
            lastFetchedFileName = mpcStatus.rawFileName;
            lastImdbId = mpcStatus.imdbID;
            lastMalId = mpcStatus.malID;
            lastConfigImdbId = config.imdb_id;
            lastConfigMalId = config.mal_id;
            lastAutoPoster = config.autoPoster;
        }
    } else if (!needsFetch) {
        if (cachedShowTitle) showTitle = cachedShowTitle;
        if (!customImageURL && cachedPoster) largeImageKey = cachedPoster;
    }

    if (mpcStatus.isStopped) {
        try {
            client.user?.setActivity({
                details: 'Idling', state: 'Nothing is playing', type: 0,
                smallImageKey: "https://imgur.com/DhYzyGS.png", smallImageText: "Idle",
                largeImageKey: "https://i.imgur.com/MwZqLN8.png", largeImageText: 'Media Player Classic',
            });
        } catch (err) {}
    } else {
        let stateText;
        if (mpcStatus.isPlaying) {
            if (fetchedEpisodeTitle) stateText = fetchedEpisodeTitle;
            else if (!mpcStatus.isFallback && mpcStatus.title && mpcStatus.title !== mpcStatus.fileName) stateText = mpcStatus.title;
            else if (showTitle) stateText = mpcStatus.rawFileName;
            else stateText = getFallbackName(mpcStatus.rawFileName);
        } else {
            stateText = `${formatTime(mpcStatus.position)} / ${formatTime(mpcStatus.duration)}`;
        }

        let largeImageText;
        if (mpcStatus.isPaused && !showTitle && fetchedEpisodeTitle) largeImageText = fetchedEpisodeTitle;
        else largeImageText = config.customBigText && config.customBigText.trim() ? config.customBigText : (fetchedReleaseDate ? `(${fetchedReleaseDate})` : (mpcStatus.releaseDate ? `(${mpcStatus.releaseDate})` : 'MPC-HC'));

        const startTimestamp = Date.now() - (mpcStatus.position * 1000);
        const endTimestamp = mpcStatus.isPlaying ? startTimestamp + (mpcStatus.duration * 1000) : startTimestamp + (mpcStatus.position * 1000);

        let nameText, detailsText, statusType;
        if (mpcStatus.isPlaying) {
            nameText = undefined;
            detailsText = showTitle || mpcStatus.rawFileName;
            statusType = showTitle ? 2 : undefined;
        } else {
            if (showTitle) {
                nameText = showTitle;
                detailsText = fetchedEpisodeTitle || (!mpcStatus.isFallback ? mpcStatus.title : mpcStatus.rawFileName);
                statusType = 0;
            } else if (fetchedEpisodeTitle) {
                nameText = undefined;
                detailsText = mpcStatus.rawFileName;
                statusType = 0;
                largeImageText = fetchedEpisodeTitle;
            } else {
                nameText = undefined;
                detailsText = mpcStatus.rawFileName;
                statusType = 0;
            }
        }

        const activityPayload = {
            name: nameText, details: detailsText, state: stateText,
            startTimestamp, endTimestamp, type: 3, statusDisplayType: statusType,
            smallImageKey: mpcStatus.isPlaying ? "https://i.imgur.com/8IYhOc2.png" : "https://i.imgur.com/CCg9fxf.png",
            smallImageText: mpcStatus.isPlaying ? "Playing" : "Paused",
            largeImageKey: largeImageKey, largeImageText: largeImageText || mpcStatus.title,
        };

        try {
            client.user?.setActivity(activityPayload);

            const currentMediaState = mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');

            if (isNewMedia) {
                checkClearConsole(); // <-- Panggil di awal sebelum print log!

                const idSource = (mpcStatus.debugIds.metadata.imdb || mpcStatus.debugIds.metadata.mal) ? "Metadata File" :
                (mpcStatus.debugIds.txt.imdb || mpcStatus.debugIds.txt.mal) ? "Txt Folder Video" :
                (config.imdb_id || config.mal_id) ? "Config.js (Manual Override)" : "TIDAK DITEMUKAN";

                const titleSource = (config.customText && config.customText.trim()) ? `Config customText -> "${config.customText}"` :
                (fetchedEpisodeTitle) ? `titles.txt -> "${fetchedEpisodeTitle}"` :
                (!mpcStatus.isFallback && mpcStatus.title) ? `Metadata Video -> "${mpcStatus.title}"` :
                `TIDAK DITEMUKAN -> Fallback ke Nama File "${mpcStatus.fileName}"`;

                const imageSource = (customImageURL) ? `Config customImage -> Aktif Digunakan` :
                (cachedPoster) ? `API Poster (TMDb/OMDb) -> Sukses` :
                `TIDAK DITEMUKAN -> Fallback ke Logo MPC-HC Default`;

                const bigTextSource = (config.customBigText && config.customBigText.trim()) ? `Config customBigText -> "${config.customBigText}"` :
                (fetchedReleaseDate) ? `titles.txt -> "${fetchedReleaseDate}"` :
                (mpcStatus.releaseDate) ? `Metadata Video -> "${mpcStatus.releaseDate}"` :
                `TIDAK DITEMUKAN -> Fallback ke "MPC-HC"`;

                console.log(`\n==================================================`);
                console.log(`🎬 [NEW MEDIA DETECTED] : ${mpcStatus.rawFileName}`);
                console.log(`==================================================`);

                console.log(`⚙️  [STATUS CONFIG.JS]`);
                let isConfigUsed = false;
                if (config.customText) { console.log(`   - customText    : OVERRIDE AKTIF -> "${config.customText}"`); isConfigUsed = true; }
                if (config.customBigText) { console.log(`   - customBigText : OVERRIDE AKTIF -> "${config.customBigText}"`); isConfigUsed = true; }
                if (customImageURL) { console.log(`   - customImage   : OVERRIDE AKTIF -> (Menggunakan Gambar Kustom)`); isConfigUsed = true; }
                if (config.imdb_id || config.mal_id) { console.log(`   - Manual ID     : OVERRIDE AKTIF -> IMDb=${config.imdb_id || '-'}, MAL=${config.mal_id || '-'}`); isConfigUsed = true; }
                if (!isConfigUsed) { console.log(`   - (Tidak ada pengaturan manual yang aktif, menggunakan mode otomatis)`); }

                console.log(`\n📦 [1. RAW INPUTS & DETEKSI ID]`);
                console.log(`   - File Asli   : ${mpcStatus.rawFileName}`);
                console.log(`   - Sumber ID   : ${idSource}`);
                console.log(`   - ID Terpakai : IMDb=${mpcStatus.imdbID || 'null'}, MAL=${mpcStatus.malID || 'null'}`);

                console.log(`\n🍳 [2. PROSES MEMASAK & FALLBACK]`);
                if (cachedFetchedTitles && cachedFetchedTitles.debugInfo) {
                    const dbg = cachedFetchedTitles.debugInfo;
                    if (dbg.loadedCount > 0 && dbg.parsedEpisode) {
                        console.log(`   - Cek Episode : Ditemukan (Ep ${dbg.parsedEpisode} dari ${dbg.titlesFile})`);
                    } else if (dbg.loadedCount > 0 && !dbg.parsedEpisode) {
                        console.log(`   - Cek Episode : TIDAK DITEMUKAN -> Fallback (Angka episode gagal dibaca regex)`);
                    } else {
                        console.log(`   - Cek Episode : TIDAK DITEMUKAN -> Fallback (File titles_sX.txt tidak ada)`);
                    }
                }
                console.log(`   - Final Title : ${titleSource}`);
                console.log(`   - Final Image : ${imageSource}`);
                console.log(`   - Big Text    : ${bigTextSource}`);

                console.log(`\n🚀 [3. FINAL PAYLOAD (RPC DISCORD)]`);
                console.log(JSON.stringify(activityPayload, null, 2));
                console.log(`==================================================\n`);

                lastLoggedFileName = mpcStatus.rawFileName;
                lastLoggedState = currentMediaState;
            }
            else if (currentMediaState !== lastLoggedState) {
                checkClearConsole(); // <-- Panggil di awal juga!

                console.log(`\n⏯️ [STATE UPDATE] -> ${currentMediaState}`);
                console.log(`   Payload Terkirim:`);
                console.log(JSON.stringify(activityPayload, null, 2));
                console.log(`--------------------------------------------------\n`);

                lastLoggedState = currentMediaState;
            }
        } catch (err) {}
    }
}

function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function convertTimeToSeconds(time) {
    const parts = time.split(':').map(Number);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// ==========================================
// DISCORD CONNECTION & AUTO-RECONNECT
// ==========================================

function initDiscord() {
    // 1. Buat ulang instance client setiap kali reconnect agar socket tidak stale/mati
    client = createClient();

    client.on('ready', () => {
        deepClearConsole();
        console.log(`Terhubung ke Discord (RPC Siap) - clientId: ${mpcId}`);

        // Bersihkan interval lama jika ini adalah hasil dari reconnect
        if (presenceInterval) clearInterval(presenceInterval);

        presenceInterval = setInterval(async () => {
            const status = await getMpcStatus();

            if (!status || status.isOffline) {
                if (!mpcOfflineLogged) {
                    deepClearConsole();
                    console.log("⏳ MPC-HC ditutup atau belum dijalankan. Menunggu pemutar...");
                    mpcOfflineLogged = true;
                    updateEventCount = 0;
                    lastLoggedFileName = null;
                    lastLoggedState = null;
                    lastPlaybackState = 'offline';
                    try { client.user?.clearActivity(); } catch (err) {}
                    resetAllCaches();
                }
                return;
            }

            mpcOfflineLogged = false;
            const currentState = status.isPlaying ? 'playing' : (status.isPaused ? 'paused' : 'stopped');

            if (currentState === 'playing') {
                lastPlaybackState = currentState;
                await updatePresence(status);
                return;
            }
            if (currentState !== lastPlaybackState) {
                lastPlaybackState = currentState;
                await updatePresence(status);
            }
        }, 5000);
    });

    client.on('disconnected', () => {
        console.log('\n⚠️ Terputus dari Discord! Menunggu Discord dibuka kembali...');
        if (presenceInterval) clearInterval(presenceInterval);

        // Jeda 5 detik, lalu inisialisasi ulang seluruh koneksi
        setTimeout(initDiscord, 5000);
    });

    let isWaitingForDiscord = false;
    const connect = async () => {
        try {
            await client.login();
            isWaitingForDiscord = false; // Reset status saat berhasil
        } catch (err) {
            // Mencegah spam log tiap 5 detik
            if (!isWaitingForDiscord) {
                console.log('⏳ Menunggu Discord dijalankan... (Otomatis menyambung jika Discord terbuka)');
                isWaitingForDiscord = true;
            }
            // Loop tanpa henti tiap 5 detik sampai Discord dibuka
            setTimeout(connect, 5000);
        }
    };

    // Jalankan siklus koneksi
    connect();
}

// Mulai sistem auto-reconnect saat script pertama kali dijalankan
initDiscord();
