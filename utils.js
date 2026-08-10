// utils.js

function cleanName(name, config, isMovieName = false) {
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
    cleanedName = cleanedName.replace(/\.{2,}/g, '.').replace(/\s+\.(mkv|mp4|avi|flv)/, '.$1').replace(/\s{2,}/g, ' ').trim();
    return cleanedName;
}

function getFallbackName(filePath) {
    const extensionMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toUpperCase() : 'unknown';
    return `${extension} Video`;
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

const _baseHash = "=0EaSFXLzlTN1QDN11SVYNXcDVkSFlzTnR0Q4d1QjpUNtQ3UZRWW0xGes9kLRZGevpWS1lzVhpnSYplMKNETkp0QahmVtNmZsd0YopUeXZTS5NGbCNjYq5kbJNXS55EaOJjT3dGRPVTWykVerR0T10EVaVTQEpVMNRVW0klaJZTSplVMO5WSzlFROlHNT9EMZpmT6VFVOFzYU1kNJlmWpVTbJNXSD10aadkT4lleOhmUt5EbKpmTxk0VaVzYUpVeJd1T4llaapmQU5EbWRUTrpUaPlWUXRGaKlXZukjSp5UMJpXVJpUaPl2YHJGaKlXZ";

// BARU: Pengekstrak Season & Episode dari Nama File (Super Aman / Strict)
function parseSeasonEpisode(filename) {
    let season = null;
    let episode = null;
    let isExplicit = false;

    // Normalisasi string: hapus kurung tag encoder dan ubah titik/underscore jadi spasi
    const normalizedName = filename.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/[\._]/g, ' ');

    // 1. Format ketat menempel/terpisah: S01E05, S1 E5, Season 1 Episode 5
    const s0e0 = normalizedName.match(/\b[Ss](\d+)\s*[Ee](\d+)\b/);
    if (s0e0) {
        return { season: parseInt(s0e0[1], 10), episode: parseInt(s0e0[2], 10), isExplicit: true };
    }

    const seq = normalizedName.match(/\bSeason\s*(\d+)\s*Ep\w*\s*(\d+)\b/i);
    if (seq) {
        return { season: parseInt(seq[1], 10), episode: parseInt(seq[2], 10), isExplicit: true };
    }

    // 2. Format pencarian Season saja atau Episode saja
    const sMatch = normalizedName.match(/\b(?:Season|S)\s*(\d+)\b/i);
    const eMatch = normalizedName.match(/(?:\bEpisode\b|\bEp\b|\bE(?=\s*\d)|\s-\s+)\s*(\d{1,4})(?!\d)/i);

    if (eMatch) {
        episode = parseInt(eMatch[1], 10);
        if (sMatch) {
            season = parseInt(sMatch[1], 10);
            isExplicit = true;
        } else {
            season = 1; 
            isExplicit = false;
        }
        return { season, episode, isExplicit };
    }

    return { season: null, episode: null, isExplicit: false };
}

module.exports = { cleanName, getFallbackName, formatTime, _baseHash, convertTimeToSeconds, parseSeasonEpisode };
