
# MPC Discord Presence

A Node.js script to display your **Media Player Classic (MPC-HC)** playback status as a Discord Rich Presence, with support for custom images, metadata, and episode titles. This script enhances your Discord profile by showing what you're watching, including video titles, playback state, and posters.

## Features

- **Dynamic Rich Presence**: Displays the current video's title, playback status (Playing/Paused), and timestamps on Discord.
- **Metadata Support**: Extracts video titles, IMDb IDs, MAL IDs, and release dates from video file metadata using `ffmpeg`.
- **Customizable Display**:
  - Set custom text, big text, and images via `config.js`.
  - Supports multiple custom images that rotate every minute.
  - Configurable status display type (`name`, `state`, or `details`).
- **Episode Titles**: Uses `titles.txt` or `titles_sX.txt` to display episode-specific titles and release dates for TV series.
- **Poster Fetching**: Automatically fetches posters from OMDb (IMDb) or Jikan (MyAnimeList) based on metadata or filename.
- **Fallback Mechanism**: Gracefully handles videos without metadata or titles, displaying file extensions (e.g., "MKV Video") or default text ("MPC-HC").
- **Interactive Menu**: Includes a CLI menu (`menu.js`) to start/stop the script, edit config, and manage settings.
- **Efficient Caching**: Only fetches metadata, titles, and posters when the file changes or config is updated, reducing API calls.
- **PM2 Integration**: Runs as a background process with `pm2` for reliable execution.
- **Windows Support**: Includes `.bat` and `.vbs` scripts for easy execution via double-click.

## Requirements

- **Node.js**: Version 16 or higher.
- **MPC-HC**: Media Player Classic with web interface enabled (default port: 13579).
- **FFmpeg**: Installed and accessible in system PATH for metadata extraction.
- **Discord**: Running on your system for Rich Presence to work.
- **Dependencies** (installed via `npm install`):
  - `@xhayper/discord-rpc`: For Discord Rich Presence.
  - `fluent-ffmpeg`: For reading video metadata.
  - `axios`: For API requests to OMDb and Jikan.
  - `@ctrl/video-filename-parser`: For parsing episode numbers from filenames.
  - `pm2`: For running the script as a background process.

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/mpc-discord-presence.git
   cd mpc-discord-presence
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Install FFmpeg**:
   - Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html).
   - Add FFmpeg to your system PATH (e.g., `C:\Program Files\ffmpeg\bin` on Windows).

4. **Enable MPC-HC Web Interface**:
   - Open MPC-HC → View → Options → Web Interface.
   - Check "Allow access from localhost" and ensure the port is set to `13579`.

5. **(Optional) Set Up OMDb API Key**:
   - Obtain an API key from [OMDb API](https://www.omdbapi.com/apikey.aspx).
   - Replace `OMDB_API_KEY` in `poster.js` with your key:
     ```javascript
     const OMDB_API_KEY = "your-api-key";
     ```

## Usage

### Option 1: Using the Interactive Menu
1. Run the menu script:
   - Double-click `menu.bat`.
   - Or use the command line:
     ```bash
     node --no-warnings menu.js
     ```
2. Menu Options:
   - **1**: Start or stop `index.js` (toggles the Discord Presence).
   - **2-9**: Edit config settings (`useCustomId`, `customId`, `imdb_id`, `mal_id`, `autoPoster`, `customText`, `customBigText`, `customType`).
   - **10**: Manage `customImage` array (add, edit, or delete image URLs).
   - **0**: Exit the menu.
3. Example menu output:
   ```
   === MPC Discord Presence Menu ===
   Status index.js: Not Active
   Config contents:
       useCustomId: false
       customId: ''
       imdb_id: ''
       mal_id: ''
       autoPoster: true
       customText: ''
       customBigText: ''
       customType: ''
       customImage: ['']
   Choose an option:
   1. Activate index.js
   2. Edit useCustomId
   ...
   10. Edit customImage
   0. Exit
   ```

### Option 2: Running Directly
1. Start the script:
   ```bash
   node index.js
   ```
2. Or run with `pm2` for background execution:
   ```bash
   npm start
   ```
3. Stop the script:
   ```bash
   npm stop
   ```

### Configuring `config.js`
Edit `config.js` to customize the Rich Presence:
```javascript
module.exports = {
    useCustomId: false, // Set to true to use a custom Discord application ID
    customId: '', // Your Discord application ID
    imdb_id: '', // Fallback IMDb ID
    mal_id: '', // Fallback MAL ID
    autoPoster: true, // Auto-fetch posters based on filename
    customText: '', // Custom state text (overrides title)
    customBigText: '', // Custom large image text
    customType: '', // 0 (name), 1 (state), 2 (details)
    customImage: [''], // Array of image URLs for large image
};
```
- Use `menu.js` to edit these settings interactively.
- `customImage` supports multiple URLs that rotate every minute.

### Creating `titles.txt` for Episode Titles
To display episode-specific titles and release dates:
1. Create a `titles.txt` or `titles_sX.txt` (e.g., `titles_s1.txt` for season 1) in the project directory.
2. Format:
   ```
   episode_number|title|release_date
   ```
   Example:
   ```
   1|The Beginning|2024-07-01
   2|The Adventure Continues|2024-07-08
   ```

## How It Works

- **Rich Presence Display**:
  - **Playing**:
    - `stateText`: `customText` > `titles.js` episode title > metadata title (non-encoder) > fallback (`MKV Video`).
    - `largeImageText`: `customBigText` > `titles.js` release date > metadata release date > `MPC-HC`.
    - `detailsText`: Show title from API (if available) or filename.
  - **Paused**:
    - `stateText`: Playback position and duration (e.g., `00:01:23 / 00:24:00`).
    - `largeImageText`: `titles.js` episode title > metadata title (non-encoder) > `MPC-HC`.
  - **Idle**: Shows "Idling" with a default image.
- **Poster Fetching**:
  - Prioritizes metadata IDs (IMDb/MAL), then config IDs, then filename-based search (if `autoPoster` is enabled).
  - Uses OMDb for movies and Jikan for anime.
- **Caching**:
  - Metadata, titles, and posters are cached to avoid redundant API calls or file parsing.
  - Cache is cleared when the file changes, config is updated, or playback stops.
- **Error Handling**:
  - Gracefully handles missing metadata, titles, or API failures with fallback values.
  - Logs detailed errors for debugging.

## Debugging

- **Check Logs**:
  ```bash
  npx pm2 logs index
  ```
- **Run Directly for Errors**:
  ```bash
  node index.js
  ```
- **Common Issues**:
  - **No Rich Presence**: Ensure Discord is running and MPC-HC web interface is enabled.
  - **API Errors**: Verify OMDb API key or check Jikan rate limits.
  - **Incorrect Titles**: Ensure `titles.txt` format is correct (`episode_number|title|release_date`).

## Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. Commit changes (`git commit -m 'Add your feature'`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Open a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
