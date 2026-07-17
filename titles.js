const fs = require('fs');
const path = require('path');

// Regex DIPERBARUI: Sekarang bisa mengenali "Book" dan "Part" layaknya "Season"
const EPISODE_PATTERN = /(?:(?:Season|Book|Part)\s*\d+|S\d+)?[\s._-]*(?:Ep(?:isode)?\s*)?0*(\d{1,4})(?=\.|_|\s|\[|$)/i;

const loadTitles = (videoDir) => {
    try {
        const files = fs.readdirSync(videoDir).filter(file =>
        file.match(/^titles\.txt$/) || file.match(/^titles_s\d+\.txt$/)
        );

        if (files.length > 1) return { titles: [], titlesFile: null };
        if (files.length === 0) return { titles: [], titlesFile: null };

        const titlesFile = files[0];
        const titlesFilePath = path.join(videoDir, titlesFile);
        const titles = [];
        const lines = fs.readFileSync(titlesFilePath, 'utf-8').split('\n');
        for (const line of lines) {
            const parts = line.trim().split('|');
            if (parts.length === 3) {
                try {
                    const episode_number = parseInt(parts[0]);
                    titles.push({ episode_number, title: parts[1], release_date: parts[2] });
                } catch (error) {}
            }
        }
        return { titles, titlesFile };
    } catch (err) {
        return { titles: [], titlesFile: null };
    }
};

const fetchIdsFromTxt = (videoDir) => {
    let imdbID = null, malID = null;
    try {
        const imdbFilePath = path.join(videoDir, 'imdb.txt');
        const malFilePath = path.join(videoDir, 'mal.txt');

        if (fs.existsSync(imdbFilePath)) {
            const imdbContent = fs.readFileSync(imdbFilePath, 'utf-8').trim();
            if (imdbContent && imdbContent.startsWith('tt')) imdbID = imdbContent;
        }
        if (fs.existsSync(malFilePath)) {
            const malContent = fs.readFileSync(malFilePath, 'utf-8').trim();
            if (malContent && !isNaN(malContent)) malID = malContent;
        }
        return { imdbID, malID };
    } catch (err) {
        return { imdbID: null, malID: null };
    }
};

const fetchTitles = async (filename, filePath) => {
    const { filenameParse } = await import('@ctrl/video-filename-parser');
    const videoDir = filePath ? path.dirname(filePath) : '.';
    const { titles, titlesFile } = loadTitles(videoDir);
    let episode = null;

    const info = filenameParse(filename, true);
    if (info.episodeNumbers && info.episodeNumbers.length > 0) {
        episode = parseInt(info.episodeNumbers[0]);
    } else {
        const match = filename.match(EPISODE_PATTERN);
        if (match) episode = parseInt(match[1]);
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
            // Kembalikan debugInfo untuk dikelola index.js secara terstruktur
            return { episodeTitle, releaseDate: matchingEpisode.release_date, debugInfo: { parsedEpisode: episode, titlesFile, loadedCount: titles.length } };
        }
    }
    return { episodeTitle: null, releaseDate: null, debugInfo: { parsedEpisode: episode, titlesFile, loadedCount: titles.length } };
};

module.exports = { fetchTitles, fetchIdsFromTxt };
