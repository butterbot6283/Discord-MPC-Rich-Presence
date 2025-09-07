// Leave everything empty '' for default settings
module.exports = {
    useCustomId: false, 
    customId: '', // your Discord app ID from developer portal
    imdb_id: '', // IMDB ID fallback for poster & show title
    mal_id: '', // MAL ID fallback for poster & show title
    autoPoster: false, // fetch poster by filename (not always accurate)
    customText: '', // replace title with custom text
    customBigText: '', // replace large image text
    customType: '', // 0 = name, 1 = state, 2 = details
    customImage: [ // replace MPC logo with your custom images
        ''
    ],
};