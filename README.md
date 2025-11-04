I can't code and english isn't my native, this script created with AI I only do testing and prompting. If you somehow find this repo, please figure it out yourself how to use it, I cant answer or speak english and this readme below is created by AI aswell. Thats all from me, hope this readme created by AI is easy to understand.

# MPC Discord Presence

A Node.js script to display your **Media Player Classic (MPC-HC)** playback status as a Discord Rich Presence, with support for custom images, metadata, and episode titles. This script enhances your Discord profile by showing what you're watching, including video titles, playback state, and posters.

<img width="271" height="104" alt="{3A0F5109-15E2-4AFD-8C52-C0B461538D8B}" src="https://github.com/user-attachments/assets/65b81ec0-b911-4dff-8fe0-c772502ca4d2" /> <img width="268" height="100" alt="{29410F2D-8CCC-4494-A03B-A93EF9216768}" src="https://github.com/user-attachments/assets/6ea88589-e3ea-4d63-af28-af44a49015ea" /> <img width="267" height="102" alt="{48A0615D-5B89-44C7-8BDD-2743B5815DD8}" src="https://github.com/user-attachments/assets/fd3fe207-8964-4d8e-ac32-74eca9991008" /> <img width="267" height="98" alt="{70CBDEBE-009F-462F-8E59-281CFDA839C5}" src="https://github.com/user-attachments/assets/adbd535c-ff58-4d10-9b13-5db658b84139" />

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
- **PM2 Integration**: Runs as a background process with `pm2` for reliable execution.
- **Windows Support**: Includes `.bat` scripts for easy execution via double-click.

## Requirements

- **Node.js**: ~~Version 16 or higher.~~ ( Use version 20 lts! Lower error in dependency, higher error in jikan API )
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

1. **Clone or Download the Repository**:
   ```bash
   git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
   cd Discord-MPC-Rich-Presence
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
    customId: '', // Your Discord application ID from the developer portal
    imdb_id: '', // IMDb ID fallback for fetching poster and show title
    mal_id: '', // MyAnimeList ID fallback for fetching poster and show title
    customText: '', // Replace video title with custom text in Discord presence
    customBigText: '', // Replace large image text in Discord presence
    useCustomId: false, // Use custom Discord app ID if true, otherwise use default
    autoPoster: false, // Fetch poster by filename if true (may be inaccurate)
    cleanFilename: true, // Clean video filename using regex patterns if true
    customImage: [ // Replace MPC logo with custom image URLs
        ''
    ],
    cleanRegex: [ // Custom regex patterns to clean video filename
        '\\b(720p|1080p|480p|BluRay|BRRip|Webrip|WEB-DL|WEBDL|HDRip|x264|x265|HEVC|HDTV|DVDRip|AAC)\\b\\s*'
    ],
    customType: '', // Discord presence type (0 = name, 1 = state, 2 = details, leave empty for auto)
};
```
- Use `menu.js` to edit these settings interactively.
- `customImage` supports multiple URLs that rotate every minute.

### Per-Video Customization: Titles and IDs in Video Directory
To avoid constantly editing `config.js` or placing files in the project directory (which can get messy for multiple videos), you can place episode titles and IDs directly in the **video's directory** (the folder containing the video file). This makes it easy to manage per-show or per-movie without affecting the global config.

- **Episode Titles (`titles.txt` or `titles_sX.txt`)**:
  - Place the file in the same folder as your video files (e.g., `C:\Videos\MyShow\Season1\titles_s01.txt`).
  - The script automatically detects and loads it from the video's directory when playing a file from there.
  - Format remains the same:
    ```
    episode_number|title|release_date
    ```
    Example:
    ```
    1|The Beginning|2024-07-01
    2|The Adventure Continues|2024-07-08
    ```
  - For seasons: Use `titles_s1.txt`. If no season file, it falls back to `titles.txt`.
  - **Benefit**: Each show's folder can have its own titles file—no need to copy to project dir or edit config.

- **IDs (`imdb.txt` and `mal.txt`)**:
  - Place these simple text files in the video's directory (e.g., next to `episode01.mkv`).
  - `imdb.txt`: Contains just the IMDb ID (e.g., `tt1234567`—must start with `tt`).
  - `mal.txt`: Contains just the MAL ID (e.g., `12345`—a number).
  - The script prioritizes these over config IDs: metadata > directory txt files > config.
  - **Benefit**: Set IDs once per folder (e.g., for a whole season), and it auto-applies without touching config.js. Great for libraries with many shows/movies.

If multiple titles files exist in a directory, it skips them to avoid conflicts. Always test with a single video to ensure detection works.

### Creating `titles.txt` for Episode Titles (Legacy/Global Option)
To display episode-specific titles and release dates (if not using per-video directories):
1. Create a `titles.txt` or `titles_sX.txt` (e.g., `titles_s1.txt` for season 1) in the **project directory**.
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
- ~~Thing I wanted to add but couldn’t~~:
  - ~~using statusDisplayType: 0 and name: (when statusDisplayType is 0, it uses the name from the client ID)~~
  - **StatusDisplayType: 0 and name support**: Now implemented—uses `name` field for showTitle as the main display when type is 0, with unified logic for play/pause.

### ~~Contributing~~
~~Contributions are welcome! Fork the repository, make changes, and submit a pull request. For feature requests or bugs, open an issue on GitHub.~~

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

### Update

- Implemented `statusDisplayType: 0` support with `name` field for displaying showTitle as the main title (previously limited to clientId custom names). Updated `getCustomType` to return 0 instead of 2 when using showTitle.
- Revised Rich Presence layout:
  - **Playing**: `details` now shows original filename with extension; `state` remains unchanged (config > titles > metadata/fallback).
  - **Paused**: `details` prioritizes fetchTitles episode title > metadata title > filename; `state` remains position/duration.
- Unified `largeImageText` for both playing and paused states: prioritizes `customBigText` > release date (from titles/metadata) > "MPC-HC".
- Removed `isUsingConfigId` and `isUsingTxtId` flags—simplifies code as `name` now uses showTitle directly if available from any source (metadata, txt, or config).
- Limited autoPoster: Fetches posters from filename search but sets `showTitle: null` to prevent inaccurate titles (e.g., sequel mismatches) from appearing in `name`; posters still used for images.
- Removed custom clientId switching—always uses fixed MPC clientId. Deleted related functions (`getCustomId`, `switchClientId`), debounce logic, and config reload checks for clientId changes. Custom names now handled via `name` field.
- Added support for per-video directory files: `titles.txt`/`titles_sX.txt` and `imdb.txt`/`mal.txt` can now be placed directly in the video's folder for easy, non-global customization without editing config.js or cluttering the project directory.



### **Play**
details as status

<img width="565" height="439" alt="{6BFD343E-60D8-4A40-BCE2-EA14F872E046}" src="https://github.com/user-attachments/assets/dc5210a5-30f6-4089-8da2-f264d4222e7c" /> 

name as status

<img width="566" height="450" alt="{CBF0419A-59B8-4DD6-BAAC-C842BF7F389A}" src="https://github.com/user-attachments/assets/3d47bfe0-74ec-4232-b819-1dcf36f650be" />


## **Pause**
details as status

<img width="565" height="444" alt="{90D472BC-9B94-421E-92B7-2FD55128DBEF}" src="https://github.com/user-attachments/assets/0e77b281-9fe8-4bb5-8c45-a1b91f0f69a7" /> 

name as status

<img width="562" height="452" alt="{74A3082B-8FBD-4465-BCC3-760ADE7D749E}" src="https://github.com/user-attachments/assets/6895eed7-c8dc-485f-a2d5-be9bb3115dea" />

