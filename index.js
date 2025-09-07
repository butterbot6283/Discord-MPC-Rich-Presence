const RPC = require('@xhayper/discord-rpc');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fetchPoster = require('./poster');
const { fetchTitles } = require('./titles');
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

// Fungsi untuk membersihkan teks dalam kurung siku [ ] dari nama file
function cleanName(name, isMovieName = false) {
    let cleanedName = name;

    if (!isMovieName) {
        cleanedName = cleanedName
            .replace(/\[.*?\]/g, '')   // Hapus [tags]
            .replace(/\b(720p|1080p|480p|BluRay|BRRip|Webrip|WEB-DL|WEBDL|HDRip|x264|x265|HEVC|HDTV|DVDRip|AAC)\b\s*/gi, '')  // Hapus resolusi dan tipe rip
            //.replace(/\b(S\d{1,2}E\d{1,2}|Episode \d{1,2}|E\d{1,2})\b/gi, '')  // Hapus episode tags [jangan hapus]
            //.replace(/\(.*?\)/g, '')   // Hapus (Dual Audio...) [jangan hapus]
            .replace(/\.{2,}/g, '.')
            .replace(/\s+\.(mkv|mp4|avi|flv)/, '.$1');
    }

    cleanedName = cleanedName
        //.replace(/[\._\-]/g, ' ')		//jangan hapus
        .replace(/\s{2,}/g, ' ')
        .trim();

    console.log(`Cleaned name: ${cleanedName}`);
    return cleanedName;
}

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

// Fungsi untuk mendapatkan nama fallback berdasarkan ekstensi file
const getFallbackName = (filePath) => {
    const extensionMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toUpperCase() : 'unknown';
    return `${extension} Video`;
};

// Fungsi untuk mendapatkan nama film dari file menggunakan ffmpeg
const getMovieName = async (filePath, fallbackFileName) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error('Error getting movie name:', err);
                return resolve(cleanName(fallbackFileName));
            }

            const track = metadata.format;
            if (config.customText && config.customText.trim()) {
                return resolve(config.customText);
            }

            if (track && track.tags && track.tags.title) {
                const title = track.tags.title;
                if (title.length > 128) {
                    if (config.customText && config.customText.trim()) {
                        return resolve(config.customText);
                    }
                    return resolve(cleanName(fallbackFileName));
                }
                return resolve(title);
            }

            return resolve(cleanName(fallbackFileName));
        });
    });
};

// Fungsi untuk mendapatkan ID (IMDb atau MAL) dari metadata file video
const getIds = (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject('Error fetching metadata: ' + err);
            } else {
                const imdbID = metadata.format.tags['IMDB_ID'] || null;
                const malID = metadata.format.tags['MAL_ID'] || null;
                resolve({ imdbID, malID });
            }
        });
    });
};

// Fungsi untuk mendapatkan tanggal rilis dari metadata file video
const getReleaseDate = (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject('Error fetching metadata: ' + err);
            } else {
                const releaseDate = metadata.format.tags['DATE_RELEASED'] || null;
                resolve(releaseDate);
            }
        });
    });
};

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

        let ids = { imdbID: null, malID: null };
        let releaseDate = null;
        let movieName = null;
        let isFallback = false;
        let isUsingConfigId = false; // Flag untuk cek apakah menggunakan ID dari config
        if (filePath) {
            ids = await getIds(filePath);
            releaseDate = await getReleaseDate(filePath);
            movieName = await getMovieName(filePath, fileName);
            // Cek apakah movieName adalah hasil fallback (tanpa customText)
            isFallback = movieName === cleanName(fileName) && !(config.customText && config.customText.trim());
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
            isUsingConfigId // Kembalikan flag
        };
    } catch (error) {
        console.error('Error fetching MPC status:', error);
        return null;
    }
};

let previousStatus = null;

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
        const { episodeTitle: fetchedEpisodeTitle, releaseDate: fetchedReleaseDate } = await fetchTitles(mpcStatus.fileName);
        if (fetchedEpisodeTitle && !mpcStatus.title.toLowerCase().startsWith('episode') && !/^S\d{2}E\d{2}/i.test(mpcStatus.title)) {
            episodeTitle = fetchedEpisodeTitle; // Prioritas 2: dari titles.txt
            releaseDate = fetchedReleaseDate;
        }

        // Panggil fetchPoster untuk showTitle jika ada ID
        if (mpcStatus.imdbID || mpcStatus.malID || config.imdb_id || config.mal_id) {
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
        } else if (config.autoPoster) {
            const titleForSearch = cleanName(mpcStatus.fileName);
            const { poster, showTitle: fetchedTitle, usedConfigId } = await fetchPoster(null, null, titleForSearch);
            if (fetchedTitle) {
                showTitle = fetchedTitle;
                console.log(`Set showTitle from fetchPoster (autoPoster): "${showTitle}"`);
            }
            if (!customImageURL) {
                largeImageKey = poster || largeImageKey;
                if (!poster) console.log('Fallback to default image: No poster found from OMDb or Jikan.');
            }
            isUsingConfigId = usedConfigId;
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
                      : getFallbackName(mpcStatus.fileName))))
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
			if ((mpcStatus.title.toLowerCase().startsWith('episode') || /^S\d{2}E\d{2}/i.test(mpcStatus.title)) && showTitle) {
				detailsText = showTitle;
				console.log(`Using show title from API for details: "${showTitle}"`);
			} else if (isUsingConfigId && showTitle) {
				detailsText = showTitle;
				console.log(`Using show title from API (config ID) for details: "${showTitle}"`);
			}

            const activityPayload = {
                name: 'Your Mom', // ga kepake, kalo statustype 0 masih pake nama dari clientId
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
    setInterval(updatePresence, 15000); // Update setiap 15 detik
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