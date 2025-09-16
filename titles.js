const { filenameParse } = require('@ctrl/video-filename-parser');
const fs = require('fs');
const path = require('path');

// Fallback regex untuk mengekstrak episode
const EPISODE_PATTERN = /(?:E|Ep|Episode| - | S?\d+ - )(\d{1,2})(?=\.|$)/i; // Cocokkan E01, Ep01, Episode 01, dll.

// Fungsi untuk memuat titles.txt atau titles_sX.txt dari direktori video
const loadTitles = (videoDir) => {
    try {
        const files = fs.readdirSync(videoDir).filter(file => 
            file.match(/^titles\.txt$/) || file.match(/^titles_s\d+\.txt$/)
        );

        // Jika ada lebih dari satu file titles, anggap tidak ada
        if (files.length > 1) {
            console.log('❌ Ditemukan lebih dari satu file titles di direktori video, anggap tidak ada file titles.');
            return { titles: [], titlesFile: null };
        }
        if (files.length === 0) {
            console.log(`❌ Tidak ada file titles.txt atau titles_sX.txt ditemukan di ${videoDir}! Menggunakan default.`);
            return { titles: [], titlesFile: null };
        }

        const titlesFile = files[0];
        const titlesFilePath = path.join(videoDir, titlesFile);
        const titles = [];
        const lines = fs.readFileSync(titlesFilePath, 'utf-8').split('\n');
        for (const line of lines) {
            const parts = line.trim().split('|');
            if (parts.length === 3) {
                try {
                    const episode_number = parseInt(parts[0]);
                    titles.push({
                        episode_number,
                        title: parts[1],
                        release_date: parts[2]
                    });
                } catch (error) {
                    console.error(`❌ Nomor episode tidak valid di ${titlesFilePath}: ${parts[0]}`);
                }
            }
        }
        console.log(`Loaded ${titles.length} episodes from ${titlesFilePath}`);
        return { titles, titlesFile };
    } catch (err) {
        console.error(`❌ Error membaca file titles di ${videoDir}:`, err);
        return { titles: [], titlesFile: null };
    }
};

// Fungsi untuk mengambil episode title dan release date
const fetchTitles = async (filename, filePath) => {
    const videoDir = filePath ? path.dirname(filePath) : '.'; // Fallback ke direktori proyek jika filePath null
    const { titles, titlesFile } = loadTitles(videoDir);
    let episode = null;

    // Coba parse dengan @ctrl/video-filename-parser
    console.log(`Parsing filename: ${filename}`);
    const info = filenameParse(filename, true); // isTv: true untuk parsing acara TV
    if (info.episodeNumbers && info.episodeNumbers.length > 0) {
        episode = parseInt(info.episodeNumbers[0]);
        console.log(`Episode parsed with video-filename-parser: ${episode}`);
    } else {
        // Fallback ke regex jika parser gagal
        const match = filename.match(EPISODE_PATTERN);
        if (match) {
            episode = parseInt(match[1]);
            console.log(`Episode parsed with fallback regex: ${episode}`);
        } else {
            console.log(`❌ Failed to parse episode from filename: ${filename}`);
        }
    }

    if (episode && titles.length > 0) {
        const matchingEpisode = titles.find(item => item.episode_number === episode);
        if (matchingEpisode) {
            const isSeasonFile = titlesFile && titlesFile.match(/^titles_s(\d+)\.txt$/);
            let episodeTitle;
            if (isSeasonFile) {
                const seasonNum = parseInt(isSeasonFile[1]).toString().padStart(2, '0');
                episodeTitle = `S${seasonNum}E${matchingEpisode.episode_number.toString().padStart(2, '0')}: ${matchingEpisode.title}`;
            } else {
                episodeTitle = `Episode ${matchingEpisode.episode_number.toString().padStart(2, '0')}: ${matchingEpisode.title}`;
            }
            console.log(`Using episode title from ${titlesFile}: "${episodeTitle}", Release: "${matchingEpisode.release_date}"`);
            return {
                episodeTitle,
                releaseDate: matchingEpisode.release_date
            };
        } else {
            console.log(`❌ No matching episode ${episode} found in ${titlesFile}`);
        }
    }
    console.log(`No episode found for ${filename} in ${titlesFile || 'titles'}`);
    return { episodeTitle: null, releaseDate: null };
};

module.exports = fetchTitles;
