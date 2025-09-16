const RPC = require('@xhayper/discord-rpc');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fetchPoster = require('./poster');
const fetchTitles = require('./titles');
const path = require('path');
let config = require('./config');

// Fungsi untuk mendapatkan custom ID dari config
const getCustomId = (cfg = require('./config')) => {
    return cfg.useCustomId && cfg.customId.trim() ? cfg.customId.trim() : null;
};

// clientId default kalau tidak ada custom
const mpcId = '1298018501814128796';

// ClientId aktif saat ini
let currentClientId = getCustomId() || mpcId;

// Fungsi untuk membuat instance RPC Client
const createClient = (clientId) => new RPC.Client({ clientId });

// Inisialisasi client dengan clientId awal
let client = createClient(currentClientId);

// ClientId switching (with debounce)
let lastClientId = null;
let lastSwitchAt = 0;

const switchClientId = async (newClientId) => {
    const now = Date.now();

    // jangan switch kalau sama
    if (lastClientId === newClientId) return;

    // jangan switch kalau terlalu cepat (debounce 5 detik)
    if (now - lastSwitchAt < 5000) {
        console.log(`⏩ Skip switching clientId to ${newClientId} (debounced)`);
        return;
    }

    try {
        await client.destroy();
        client = createClient(newClientId);
        await client.login();
        lastClientId = newClientId;
        lastSwitchAt = now;
        console.log(`✅ Switched clientId to ${newClientId}`);
    } catch (err) {
        console.error('❌ Error switching clientId:', err);
    }
};

//config reload
const reloadConfig = () => {
    delete require.cache[require.resolve('./config')];
    const newConfig = require('./config');
    const newClientId = getCustomId(newConfig) || mpcId;

    // cek perubahan id
    if (currentClientId !== newClientId) {
        switchClientId(newClientId);
        console.log("🔄 ClientId changed to:", newClientId);
        currentClientId = newClientId; // sinkronkan
    }

    config = newConfig;
    console.log("⚙️ Config reloaded:", config);
};

setInterval(reloadConfig, 15000);

// Fungsi untuk membersihkan teks dalam kurung siku [ ] dari nama file
function cleanName(name, isMovieName = false) {
    let cleanedName = name;

    if (!isMovieName && config.cleanFilename !== false) { // Periksa cleanFilename
        // Regex default
        cleanedName = cleanedName
            .replace(/\[.*?\]/g, '')   // Hapus [tags]
            .replace(/\.{2,}/g, '.')   // Ganti titik ganda dengan satu titik
            .replace(/\s+\.(mkv|mp4|avi|flv)/, '.$1'); // Hilangkan spasi sebelum ekstensi

        // Terapkan regex kustom dari config.cleanRegex
        if (Array.isArray(config.cleanRegex) && config.cleanRegex.length > 0) {
            config.cleanRegex.forEach(regex => {
                try {
                    const re = new RegExp(regex, 'gi');
                    cleanedName = cleanedName.replace(re, '');
                    console.log(`Applied custom regex "${regex}" to clean name: ${cleanedName}`);
                } catch (err) {
                    console.error(`Invalid regex in cleanRegex: "${regex}"`, err);
                }
            });
        }
    }

    cleanedName = cleanedName
        //.replace(/[\._\-]/g, ' ') // Ganti titik, underscore, dan tanda hubung dengan spasi [nonaktif]
        //.replace(/\(.*?\)/g, '') // Hapus teks dalam kurung biasa [nonaktif]
        .replace(/\s{2,}/g, ' ') // Ganti spasi ganda dengan satu spasi
        .trim();

    console.log(`Cleaned name: ${cleanedName}`);
    return cleanedName;
}

// Fungsi untuk mendapatkan nama fallback berdasarkan ekstensi file
const getFallbackName = (filePath) => {
    const extensionMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toUpperCase() : 'unknown';
    return `${extension} Video`;
};

// Variabel cache untuk metadata dari ffprobe
let lastFilePath = null;
let cachedMetadata = null; // { metaTitle, imdbID, malID, releaseDate, isError }

// Variabel untuk menyimpan indeks gambar saat ini
let currentImageIndex = 0;

// Fungsi untuk mendapatkan custom image
const getCustomImage = () => {
    if (Array.isArray(config.customImage) && config.customImage.some(image => image.trim())) {
        let image = config.customImage[currentImageIndex].trim() || null;
        currentImageIndex = (currentImageIndex + 1) % config.customImage.length;
        return image;
    }
    return null;
};

let customImageURL = getCustomImage();

setInterval(() => {
    customImageURL = getCustomImage();
}, 60000);

// Fungsi untuk mendapatkan custom big text
const getCustomBigText = () => {
    return config.customBigText.trim() || null;
};

// Fungsi untuk mendapatkan custom status display type
const getCustomType = (detailsText, showTitle) => {
	console.log(`getCustomType: detailsText="${detailsText}", showTitle="${showTitle}"`);
    if (config.customType !== undefined && config.customType !== '') {
        const type = parseInt(config.customType);
        if ([0, 1, 2].includes(type)) {
            console.log(`Using customType from config: ${type}`);
            return type;
        }
    }
    // Jika customType kosong, gunakan logika berdasarkan detailsText
    return detailsText === showTitle && showTitle ? 2 : undefined; // 2 jika pakai showTitle, 0 jika pakai fileName atau showTitle null
};

// Fungsi untuk mendapatkan status dari MPC melalui Web Interface
let cleanedFileName = '';
const getMpcStatus = async () => {
    try {
        const response = await axios.get('http://127.0.0.1:13579/variables.html');
        const data = response.data;

        const fileNameMatch = data.match(/<p id="file">(.+?)<\/p>/);
        let fileName = fileNameMatch ? fileNameMatch[1].trim() : 'Unknown File';
        cleanedFileName = cleanName(fileName);

        const filePathMatch = data.match(/<p id="filepath">(.+?)<\/p>/);
        const filePath = filePathMatch ? decodeURIComponent(filePathMatch[1].trim()) : null;
		console.log(`Extracted filePath: ${filePath}`);

        let ids = { imdbID: null, malID: null };
        let releaseDate = null;
        let movieName = null;
        let isFallback = false;
        let isUsingConfigId = false; // Flag untuk cek apakah menggunakan ID dari config

        if (filePath) {
            if (filePath !== lastFilePath || !cachedMetadata) {
                await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(filePath, (err, metadata) => {
                        if (err) {
                            console.error('Error fetching metadata:', err);
                            cachedMetadata = { isError: true };
                            lastFilePath = filePath;
                            resolve();
                            return;
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
                const metaTitle = cachedMetadata.metaTitle;
                releaseDate = cachedMetadata.releaseDate;
                ids = { imdbID: cachedMetadata.imdbID, malID: cachedMetadata.malID };

                if (config.customText && config.customText.trim()) {
                    movieName = config.customText;
                } else if (metaTitle && metaTitle.length <= 128) {
                    movieName = metaTitle;
                } else {
                    movieName = cleanName(fileName);
                    isFallback = true;
                }
            } else {
                movieName = cleanName(fileName);
                isFallback = true;
            }
            // Cek apakah akan menggunakan ID dari config
            isUsingConfigId = (!ids.imdbID && config.imdb_id) || (!ids.malID && config.mal_id);
        } else {
            movieName = cleanName(fileName);
            isFallback = true;
            isUsingConfigId = config.imdb_id || config.mal_id; // Gunakan config ID jika filePath tidak ada
        }

        const cleanedMovieName = cleanName(movieName);

        const currentTimeMatch = data.match(/(\d{2}:\d{2}:\d{2})/g);
        const currentTime = currentTimeMatch ? currentTimeMatch[0] : '00:00:00';
        const totalTime = currentTimeMatch ? currentTimeMatch[1] : '00:00:00';

        const currentSeconds = convertTimeToSeconds(currentTime);
        const totalSeconds = convertTimeToSeconds(totalTime);

        const isPlaying = /<p id="state">2<\/p>/.test(data);
        const isPaused = /<p id="state">1<\/p>/.test(data);
        const isStopped = /<p id="state">-1<\/p>/.test(data);

        const bigText = releaseDate || getCustomBigText();

        return {
            fileName: cleanedFileName,
            title: cleanedMovieName,
            position: currentSeconds,
            duration: totalSeconds,
            isPlaying: isPlaying,
            isPaused: isPaused,
            isStopped: isStopped,
            bigText: bigText,
            imdbID: ids.imdbID,
            malID: ids.malID,
            releaseDate,
            isFallback,
			filePath,
            isUsingConfigId // Kembalikan flag
        };
    } catch (error) {
        console.error('Error fetching MPC status:', error);
        return null;
    }
};

let previousStatus = null;

// Cache variables for fetchPoster
let cachedPoster = null;
let cachedShowTitle = null;
let lastFetchedFileName = null;
let cachedIsUsingConfigId = false;
let lastImdbId = null;
let lastMalId = null;
let lastConfigImdbId = null;
let lastConfigMalId = null;
let lastAutoPoster = config.autoPoster;

// Cache variables for fetchTitles
let lastFetchedTitlesFileName = null;
let cachedFetchedTitles = null; // { episodeTitle, releaseDate }
let lastTitlesMtime = null; // Cache untuk timestamp modifikasi titles.txt
let lastTitlesSeasonMtime = null; // Cache untuk timestamp modifikasi titles_sX.txt

// Fungsi reset semua cache
const resetAllCaches = () => {
    cachedMetadata = null;
    lastFilePath = null;
    cachedFetchedTitles = null;
    lastFetchedTitlesFileName = null;
    cachedPoster = null;
    cachedShowTitle = null;
    cachedIsUsingConfigId = false;
    lastFetchedFileName = null;
    lastImdbId = null;
    lastMalId = null;
    lastConfigImdbId = null;
    lastConfigMalId = null;
    lastAutoPoster = null;
    console.log('All caches reset due to MPC not found or closed.');
};

// Fungsi untuk memperbarui status Discord Rich Presence
async function updatePresence() {
    const mpcStatus = await getMpcStatus();

    if (mpcStatus) {
        const currentStatus = mpcStatus.isStopped ? 'idle' : 'playing';
        if (previousStatus !== currentStatus) {
            const newClientId = currentStatus === 'idle' 
                ? mpcId
                : (getCustomId() || mpcId);
            await switchClientId(newClientId);
        }
        previousStatus = currentStatus;

        let showTitle = null; // Default ke fileName
        let isUsingConfigId = false;
        let largeImageKey;

        // Cek customImage dari config
        if (customImageURL) {
            largeImageKey = customImageURL;
            console.log(`Using customImage: ${largeImageKey}`);
        } else {
            largeImageKey = 'https://i.imgur.com/MwZqLN8.png';
        }
		
		// CHANGED: Gunakan fetchTitles untuk mendapatkan episodeTitle dan releaseDate
        let episodeTitle = mpcStatus.title; // Prioritas 1: dari metadata
		let releaseDate = mpcStatus.releaseDate || '';
		let needsFetchTitles = mpcStatus.fileName !== lastFetchedTitlesFileName;
		if (needsFetchTitles) {
			const titles = await fetchTitles(mpcStatus.fileName, mpcStatus.filePath || null);
			fetchedEpisodeTitle = titles.episodeTitle;
			fetchedReleaseDate = titles.releaseDate;
			cachedFetchedTitles = { episodeTitle: fetchedEpisodeTitle, releaseDate: fetchedReleaseDate };
			lastFetchedTitlesFileName = mpcStatus.fileName;
			console.log(`Updated titles cache: episodeTitle="${fetchedEpisodeTitle}", releaseDate="${fetchedReleaseDate}"`);
		} else if (cachedFetchedTitles) {
			fetchedEpisodeTitle = cachedFetchedTitles.episodeTitle;
			fetchedReleaseDate = cachedFetchedTitles.releaseDate;
			console.log(`Using cached titles: episodeTitle="${fetchedEpisodeTitle}", releaseDate="${fetchedReleaseDate}"`);
		}
		if (fetchedEpisodeTitle && !mpcStatus.title.toLowerCase().startsWith('episode') && !/^S\d{2}E\d{2}/i.test(mpcStatus.title)) {
			episodeTitle = fetchedEpisodeTitle; // Prioritas 2: dari titles.txt
			releaseDate = fetchedReleaseDate || releaseDate;
		}

        // Logic caching untuk fetchPoster
        const needsFetch = 
			mpcStatus.fileName !== lastFetchedFileName ||
			mpcStatus.imdbID !== lastImdbId ||
			mpcStatus.malID !== lastMalId ||
			config.imdb_id !== lastConfigImdbId ||
			config.mal_id !== lastConfigMalId ||
			config.autoPoster !== lastAutoPoster;

		if (needsFetch && (mpcStatus.imdbID || mpcStatus.malID || config.imdb_id || config.mal_id || config.autoPoster)) {
			const titleForSearch = cleanName(mpcStatus.fileName);
			const { poster, showTitle: fetchedTitle, usedConfigId } = await fetchPoster(mpcStatus.imdbID, mpcStatus.malID, titleForSearch);
			if (fetchedTitle) {
				showTitle = fetchedTitle;
				console.log(`Set showTitle from fetchPoster: "${showTitle}"`);
			}
			if (!customImageURL) {
				largeImageKey = poster || largeImageKey;
				if (!poster) console.log('Fallback to default image: No poster found from OMDb or Jikan.');
			}
			isUsingConfigId = usedConfigId;

			// Update cache
			cachedPoster = poster;
			cachedShowTitle = fetchedTitle;
			cachedIsUsingConfigId = usedConfigId; // Simpan isUsingConfigId ke cache
			lastFetchedFileName = mpcStatus.fileName;
			lastImdbId = mpcStatus.imdbID;
			lastMalId = mpcStatus.malID;
			lastConfigImdbId = config.imdb_id;
			lastConfigMalId = config.mal_id;
			lastAutoPoster = config.autoPoster;
		} else if (!needsFetch) {
			// Gunakan cache jika tidak perlu fetch ulang
			if (cachedShowTitle) {
				showTitle = cachedShowTitle;
				console.log(`Using cached showTitle: "${showTitle}"`);
			}
			if (!customImageURL && cachedPoster) {
				largeImageKey = cachedPoster;
				console.log(`Using cached poster: "${largeImageKey}"`);
			}
			isUsingConfigId = cachedIsUsingConfigId; // Gunakan cached isUsingConfigId
			console.log(`Using cached isUsingConfigId: ${isUsingConfigId}`);
		} else {
            console.log(`No IMDb or MAL ID found in video or config, and autoPoster is disabled. Using default title: "${showTitle}"`);
        }

        if (mpcStatus.isStopped) {
            await switchClientId(mpcId);
            try {
                client.user?.setActivity({
                    details: 'Idling',
                    state: 'Nothing is playing',
                    type: 0,
                    smallImageKey: "https://imgur.com/DhYzyGS.png",
                    smallImageText: "Idle",
                    largeImageKey: "https://i.imgur.com/MwZqLN8.png",
                    largeImageText: 'Media Player Classic',
                });
                console.log('No file playing. Set presence to "Idling".');
            } catch (err) {
                console.error('Error setting idle activity:', err);
            }
        } else {
            const smolIcon = mpcStatus.isPlaying
                ? "https://i.imgur.com/8IYhOc2.png"
                : "https://i.imgur.com/CCg9fxf.png";
            const smolText = mpcStatus.isPlaying ? "Playing" : "Paused";
            const stateText = mpcStatus.isPlaying 
                ? (config.customText && config.customText.trim() ? config.customText 
                  : (fetchedEpisodeTitle ? fetchedEpisodeTitle 
                    : (mpcStatus.title && !mpcStatus.title.match(/\[.*?\]/) && !mpcStatus.isFallback ? mpcStatus.title
                      : (isUsingConfigId ? mpcStatus.fileName : getFallbackName(mpcStatus.fileName)))))
                : `${formatTime(mpcStatus.position)} / ${formatTime(mpcStatus.duration)}`;
            console.log(`stateText set to: "${stateText}"`);

            let largeImageText;
            if (mpcStatus.isPlaying) {
                largeImageText = config.customBigText && config.customBigText.trim() 
                    ? config.customBigText 
                    : (fetchedReleaseDate ? `(${fetchedReleaseDate})` : (mpcStatus.releaseDate ? `(${mpcStatus.releaseDate})` : 'MPC-HC'));
            } else {
                largeImageText = fetchedEpisodeTitle || (!mpcStatus.isFallback ? mpcStatus.title : 'MPC-HC');
            }

            const startTimestamp = mpcStatus.isPlaying ? Date.now() - (mpcStatus.position * 1000) : Date.now() - (mpcStatus.position * 1000);
            const endTimestamp = mpcStatus.isPlaying ? startTimestamp + (mpcStatus.duration * 1000) : startTimestamp + (mpcStatus.position * 1000);

            let detailsText = mpcStatus.fileName;
			if (showTitle && (isUsingConfigId || mpcStatus.title.toLowerCase().startsWith('episode') || /^S\d{2}E\d{2}/i.test(mpcStatus.title))) {
				detailsText = showTitle;
				console.log(`Using show title from API for details: "${showTitle}" (isUsingConfigId: ${isUsingConfigId})`);
			}

            const activityPayload = {
                name: 'Unused', // ga kepake, kalo statustype 0 masih pake nama dari clientId
                details: detailsText,
                state: stateText,
                startTimestamp: startTimestamp,
                endTimestamp: endTimestamp,
                type: 3,
                statusDisplayType: getCustomType(detailsText, showTitle),
                smallImageKey: smolIcon,
                smallImageText: smolText,
                largeImageKey: largeImageKey,
                largeImageText: largeImageText || mpcStatus.title,
            };
            console.log('setActivity payload:', JSON.stringify(activityPayload, null, 2));
            try {
                client.user?.setActivity(activityPayload);
                console.log(`Updated presence: ${mpcStatus.title} at ${mpcStatus.position}/${mpcStatus.duration}`);
            } catch (err) {
                console.error('Error setting activity:', err);
            }
        }
    } else {
        console.log('MPC status is null. Clearing activity.');
        try {
            client.user?.clearActivity();
        } catch (err) {
            console.error('Error clearing activity:', err);
        }
		resetAllCaches();
    }
}

// Format waktu dalam detik menjadi format hh:mm:ss
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    } else {
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
}

// Konversi waktu dari format hh:mm:ss menjadi detik
function convertTimeToSeconds(time) {
    const parts = time.split(':').map(Number);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Koneksi ke Discord saat pertama kali
client.on('ready', () => {
    console.log(`Connected to Discord with clientId: ${currentClientId}`);
    setInterval(updatePresence, 5000); // Update setiap 15 detik
});

client.on('disconnected', () => {
    console.log('Disconnected from Discord.');
});

// Fungsi login ke Discord
async function loginToDiscord() {
    try {
        await client.login();
        console.log(`Logged in to Discord with clientId: ${currentClientId}`);
    } catch (err) {
        console.error('Error connecting to Discord:', err);
        if (err.message.includes('ENOENT') || err.message.includes('ECONNREFUSED')) {
            console.error('IPC connection failed. Please ensure Discord is running and accessible.');
        }
    }
}

// Inisialisasi koneksi ke Discord pertama kali
loginToDiscord();
