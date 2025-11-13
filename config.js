// Leave everything empty '' for default settings
module.exports = {
    imdb_id: '', // IMDb ID fallback for fetching poster and show title
    mal_id: '', // MyAnimeList ID fallback for fetching poster and show title
    customText: '', // Replace video title with custom text in Discord presence
    customBigText: '', // Replace large image text in Discord presence
    autoPoster: false, // Fetch poster by filename if true (may be inaccurate)
    cleanFilename: true, // Clean video filename using regex patterns if true
    customImage: [ // Replace MPC logo with custom image URLs
        ''
    ],
    cleanRegex: [ // Custom regex patterns to clean video filename
        '\\b(720p|1080p|480p|BluRay|BRRip|Webrip|WEB-DL|WEBDL|HDRip|x264|x265|HEVC|HDTV|DVDRip|AAC)\\b\\s*',
		'10bit-Pahe.in'
    ],
};
