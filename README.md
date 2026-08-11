I can't code and english isn't my native, this script created with AI I only do testing and prompting. If you somehow find this repo, please figure it out yourself how to use it, I cant answer or speak english and this readme below is created by AI aswell. Thats all from me, hope this readme created by AI is easy to understand.

# MPC Discord Presence

> A Node.js script to display your **Media Player Classic (MPC-HC)** playback as a Discord Rich Presence — with automatic poster fetching, episode titles, TMDb/MAL integration, Romaji support, slideshow, and live config reloading.

<div align="left">

<!-- Replace with your actual screenshot links -->
## Playing
<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/11bef610-d18a-45b5-86d4-bedc46b691a1" /> <img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/f07add1f-28a7-4461-81ef-0c6aff68bbcc" />



## Paused
<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/20c238f8-1008-4165-973f-ba1bd2c7f625" />

## Idle
<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/04ed2d03-558a-4b8d-863a-f89a7d20a429" />


</div>

---

## Features

### Discord Rich Presence
Displays real-time playback status on your Discord profile. Shows the video title, current state (Playing/Paused/Idle), timestamps, a poster image, and an optional clickable TMDb link on the activity.
 
### Video Title Detection (via FFprobe)
Reads the embedded `title` tag directly from your video file using `ffprobe` with a 3-second timeout to prevent hangs. That's the only thing pulled from video metadata — **TMDb/MAL IDs and release dates are never read from the video file itself**, only from `tmdb.txt`/`mal.txt` (see [Folder Metadata](#folder-metadata)) or `config.json`. Falls back to the filename as the title if no `title` tag is present.
 
### AutoPoster Pipeline (TMDb + Jikan)
Automatically finds the correct poster/show info through a lookup chain, in priority order:
1. `mal.txt` / `tmdb.txt` / `group.txt` in the video's folder → Jikan or TMDb API
2. `mal_id` / `tmdb_id` in `config.json` → Jikan or TMDb API
3. Filename search (cascade, see below) → TMDb API
Results are cached locally in `rpc_cache.json` inside the video folder (or the project folder if the video folder is not writable). The cache is permanent unless you change the `dont` filter or the group ID — switching `autoPoster`, `romajiTitle`, or other visual settings does **not** bust the cache.
 
### Cascade Filename Search
When no ID is available anywhere, the script searches TMDb by filename using a multi-stage "cascade" so a single bad guess (wrong year, leftover season marker) doesn't fail the whole lookup:
1. Try the cleaned title **with** the year parsed from the filename.
2. If that fails, retry the same title **without** the year — a year in the filename is only used to pick between multiple matches (e.g. a remake), never a hard requirement. So if the title is right but the year is off, you still get the correct result.
3. If it still fails, retry both of the above on the opposite media type (TV ↔ Movie).
4. If it *still* fails, strip season indicators (`S2`, `Season 2`, `Part 2`, `Cour 2`) from the title and repeat the cascade — handles files like `Fairy Tail S2 (2014)` where the show's TMDb entry only has the original season's air date.
5. As a last resort, strip a trailing standalone number or roman numeral (`Sword Art Online II` → `Sword Art Online`) and repeat once more.
Every retry is logged so you can see exactly which stage found (or failed to find) a match.

### Romaji Title
When `romajiTitle` is enabled, the script prefers the Romaji transliteration fetched from TMDb's alternative titles (JP/Romaji or Transliteration type). Both the standard and Romaji titles are always saved to cache so toggling this setting takes effect instantly without a new API call.

<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/f07add1f-28a7-4461-81ef-0c6aff68bbcc" />
<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/57580ff3-832d-4f53-ae7d-045026480e06" />


### Random Poster
When `randomPoster` is enabled, a random poster is selected from the full list of English-language posters returned by TMDb instead of always using the first one.

<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/39d6ca48-c7dd-47a8-bb78-8a60ef4adfca" /><img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/ad80f955-6da1-4f48-b72e-66e418530744" />


### Season-Aware Episode Formatting
When episode titles come from TMDb (`autoEpisode`), the display format adapts to the season number:
- **Season 0** (TMDb's convention for Specials/OVA/ONA) → `Special Episode X: Title`
- **Season 1** → `Episode X: Title` (no season prefix)
- **Season 2 and up** → `S0XE0X: Title`
If a `titles_sX.txt` file exists in the video folder, its season number takes priority over whatever is parsed from the filename. Episode titles sourced from `titles.txt` / `titles_sX.txt` themselves always keep their own format (`Episode XX: Title` or `S0XE0X: Title` based on the filename) regardless of this rule — this only affects titles auto-fetched from TMDb.
 
### Movie Tagline & Release Date
For movies (no episode detected), the large image tooltip automatically combines the TMDb tagline and release date, e.g. `"One. Last. Ride." (Jun 25, 2026)`. Falls back to just the release date if no tagline is available, and is skipped entirely if `customBigText` is set.

### Slideshow
Set `slideshowInterval` (in seconds) to rotate through multiple custom images or TMDb posters on a timer. Supports both random cycling (if `randomPoster` is on) and sequential cycling. Set to `0` to disable.

### Live Config Reload
`presence.js` watches `config.json` with `fs.watch`. Any change saved by `menu.js` is picked up automatically within 500 ms. Changes that affect API results (autoPoster, autoEpisode, autoDate, romajiTitle, dont, IDs, cleanFilename) reset the cache and re-fetch. Changes that only affect display (customText, customBigText, customImage, slideshowInterval, randomPoster) update Discord immediately without clearing the cache.

### Live TXT Watcher
The script also watches the currently playing video's folder for changes to `tmdb.txt`, `mal.txt`, `titles.txt`, and `group.txt`. Editing or adding any of those files while the script is running triggers a full cache reset and re-fetch automatically.

### Auto Reconnect
`index.js` handles Discord connection lifecycle automatically. On disconnect it destroys the old client and creates a brand-new one every 5 seconds until Discord is available again. Pending intervals and memory are cleaned up on every reconnect cycle to prevent leaks.

### Structured Logging
`logger.js` prints a detailed breakdown to the console on every new media detection:
- Raw filename and clean filename
- Active config overrides
- ID source (metadata / txt / config)
- Cache status (online API call vs. offline cache load)
- Episode title resolution path
- Final Discord payload (JSON)

The console auto-clears every 10 update events to stay readable.

### CLI Menu (`menu.js` / `menu.bat`)
An interactive terminal menu built with `readline`. Lets you start/stop the PM2 process, view live logs, and edit every config option without touching `config.json` manually. Changes are written and picked up live immediately.

---

## Requirements

- **Node.js** v18 or higher
- **MPC-HC** with the Web Interface enabled (default port `13579`)
- **FFprobe** (part of FFmpeg) installed and in your system `PATH`
- **Discord** running on your system
- **npm packages** (installed via `npm install`):
  - `@xhayper/discord-rpc` — Discord Rich Presence client
  - `axios` — HTTP requests to TMDb and Jikan APIs
  - `@ctrl/video-filename-parser` — Episode number parsing from filenames
  - `pm2` — Background process management

---

## Installation

### Windows

1. Clone or download this repository:
   ```bat
   git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
   cd Discord-MPC-Rich-Presence
   ```
2. Install dependencies:
   ```bat
   npm install
   ```
3. Double-click `menu.bat` to launch the interactive menu and start the script.

### Linux

1. Clone the repository:
   ```bash
   git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
   cd Discord-MPC-Rich-Presence
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start via the menu:
   ```bash
   node --no-warnings menu.js
   ```

### Enable MPC-HC Web Interface

Open MPC-HC → **View → Options → Player → Web Interface**. Check **"Allow access from localhost"** and confirm the port is `13579`.

### Install FFprobe

Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html). Add the `bin` folder to your system `PATH` (e.g. `C:\Program Files\ffmpeg\bin` on Windows). Verify with:
```bash
ffprobe -version
```

---

## TMDb API Setup

The script includes a built-in shared API token so it works out of the box. For higher rate limits or a private key, get a free token from [The Movie Database](https://www.themoviedb.org/settings/api) and paste it into the menu under **Edit Text & IDs → personal_tmdb_token**, or set it directly in `config.json`.

---

## Configuration

### config.json

```json
{
    "personal_tmdb_token": "",
    "tmdb_id": "",
    "mal_id": "",
    "customText": "",
    "customBigText": "",
    "autoPoster": true,
    "autoEpisode": true,
    "autoDate": true,
    "cleanFilename": true,
    "romajiTitle": false,
    "randomPoster": true,
    "slideshowInterval": 0,
    "dont": "nah",
    "customImage": [""],
    "cleanRegex": [
        "\\b(2160p|1080p|720p|480p)\\b",
        "\\b(BluRay|BRRip|BDRip|WEBRip|WEB-DL|WEB-HD|WEBDL|HDRip|HDTV|DVDRip|CAM|TS|TC)\\b",
        "\\b(x264|x265|H264|H265|HEVC|AAC|AC3|EAC3|DTS|FLAC|10bit|8bit)\\b",
        "\\b\\d{2,4}MB\\b",
        "\\b\\d{1,2}\\.\\d{1,2}GB\\b",
        "-?Pahe\\.in",
        "-?PSA",
        "-?YTS\\.[A-Z]{2}",
        "-?Pahe\\.ph"
    ]
}
```

### Every Option Explained
 
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `personal_tmdb_token` | string | `""` | Your personal TMDb Bearer token. Leave empty to use the built-in shared token. |
| `tmdb_id` | string | `""` | Global TMDb ID override. Applied to every video when set. Overridden by `tmdb.txt` or file metadata. |
| `mal_id` | string | `""` | Global MyAnimeList ID override. Same priority as `tmdb_id`. |
| `customText` | string | `""` | Replaces the video title in the `details` field. Overrides everything when set. |
| `customBigText` | string | `""` | Replaces the large image tooltip text. Overrides release date display when set. |
| `autoPoster` | bool | `true` | Enables automatic poster fetching from TMDb / Jikan. Also controls whether `showTitle` appears in the presence. |
| `autoEpisode` | bool | `true` | Enables fetching episode titles from TMDb. If disabled, only `titles.txt` files are used. |
| `autoDate` | bool | `true` | Enables showing the release date fetched from TMDb in the large image tooltip. |
| `cleanFilename` | bool | `true` | Strips bracketed tags and applies `cleanRegex` patterns before displaying the filename. |
| `romajiTitle` | bool | `false` | Prefers the Romaji transliteration of the show title from TMDb when available. |
| `randomPoster` | bool | `true` | Picks a random poster from the TMDb poster list instead of the first one. |
| `slideshowInterval` | number | `0` | Seconds between poster/image rotations. `0` disables the slideshow. |
| `dont` | string | `"okay"` | Just Don't. |
| `customImage` | array | `[""]` | Array of image URLs to use instead of the auto-fetched poster. Supports slideshow rotation if multiple URLs are provided. |
| `cleanRegex` | array | *(see above)* | Array of regex patterns applied to the filename when `cleanFilename` is `true`. |

### Examples

**Force a specific show for every video in a session:**
```json
{
    "tmdb_id": "1396",
    "autoEpisode": true,
    "autoDate": true
}
```

**Use a custom Discord image and override all text:**
```json
{
    "customText": "Watching something",
    "customBigText": "Mind your business",
    "customImage": ["https://i.imgur.com/yourimage.png"],
    "autoPoster": false
}
```

**Slideshow with 3 images, rotating every 60 seconds:**
```json
{
    "customImage": [
        "https://i.imgur.com/image1.png",
        "https://i.imgur.com/image2.png",
        "https://i.imgur.com/image3.png"
    ],
    "slideshowInterval": 60
}
```

---

## Folder Metadata

For per-show customization, place plain text files directly in the **same folder as your video files**. The script watches this folder in real-time and reloads automatically when any of these files change.

### `tmdb.txt`

Contains a single TMDb ID (numeric, e.g. `1396`). Takes priority over `config.json` but is overridden by embedded file metadata.

```
1396
```

### `mal.txt`

Contains a single MyAnimeList ID (numeric, e.g. `21`).

```
21
```

### `group.txt`

Contains a TMDb Episode Group ID (alphanumeric string, e.g. `69afde2c03e49b16d980f4d7`). When present, episode lookup uses the episode group ordering instead of the standard season ordering. Useful for shows with alternate episode orderings (e.g. Dragon Ball, One Piece).

```
69afde2c03e49b16d980f4d7
```

<img width="1048" height="469" alt="image" src="https://github.com/user-attachments/assets/6763b88a-ff90-46f0-9a09-02dc57b9ca1e" />


### `titles.txt` / `titles_sX.txt`

A plain text file listing episode titles and release dates for offline episode name display without any API call. Place in the video folder.

**Format:**
```
episode_number|title|release_date
```

**Example `titles.txt`:**
```
1|Pilot|2008-01-20
2|Cat's in the Bag|2008-01-27
3|...And the Bag's in the River|2008-02-10
```

**Example `titles_s2.txt`** (season-specific file):
```
1|Seven Thirty-Seven|2009-03-08
2|Down|2009-03-15
```

When a season file (`titles_sX.txt`) is used, episode labels are formatted as `S02E01: Title`. When the generic `titles.txt` is used, labels are formatted as `Episode 01: Title`. If more than one titles file exists in the same folder the script skips all of them to avoid conflicts.

### ID Priority Order
 
From highest to lowest:
1. Folder text files (`tmdb.txt`, `mal.txt`, `group.txt`)
2. `config.json` (`tmdb_id`, `mal_id`)
3. Auto filename search (cascade, see [Cascade Filename Search](#cascade-filename-search))
Video file metadata is **not** used for IDs at all — `ffprobe` only reads the `title` tag.
 
---
 
## AutoPoster Pipeline
 
When a new file is detected, the poster/ID lookup runs in this exact order and stops at the first successful result:
 
```
New File Detected
      │
      ├─► Folder txt files ──────────► tmdb.txt / mal.txt / group.txt found?
      │         No ▼
      ├─► config.json ───────────────► tmdb_id / mal_id set?
      │         No ▼ (autoPoster: true required from here)
      ├─► MAL ID → Jikan API ────────► poster + showTitle
      ├─► TMDb ID → TMDb API ────────► poster + showTitle + episodes
      └─► Filename Search → TMDb ────► Cascade search:
                 │                       1. Title + year
                 │                       2. Title only (no year)
                 │                       3. Repeat 1-2 on opposite type (TV ↔ Movie)
                 │                       4. Strip season indicator, repeat
                 │                       5. Strip trailing number, repeat
                 ▼
           Result cached in rpc_cache.json (folder-local or project root)
```
 
The cache key is the TMDb/MAL ID if known, or the cleaned filename for autoPoster searches. The cache is invalidated only when the `dont` setting or `groupID` changes. All other config toggles are applied at read time from the cached data.
 
---
 
## Rich Presence Layout
 
### Playing State
 
| Field | Source (priority order) |
|-------|------------------------|
| `name` | Show title from TMDb/Jikan (when `autoPoster` is on) |
| `details` | Show title (type 2) or filename (type 0) |
| `state` | Episode title from `titles.txt`/`titles_sX.txt` → TMDb episode title (season-aware format, see [Season-Aware Episode Formatting](#season-aware-episode-formatting)) → filename |
| `largeImageKey` | `customImage` → TMDb poster → MPC-HC default logo |
| `largeImageText` | `customBigText` → for movies: TMDb tagline + release date → episode title (when paused, `autoPoster` off) → release date from TMDb/`titles.txt` → `"MPC-HC"` |
| `smallImageKey` | Play icon |
| `startTimestamp` | Current position offset from now |
| `endTimestamp` | Calculated from duration |
| `detailsUrl` | Clickable TMDb link (when `showTitle` matches `details`) |
 
### Paused State
 
| Field | Source |
|-------|--------|
| `details` | Show title → episode title → filename |
| `state` | `position / duration` (e.g. `12:34 / 24:00`) |
| `largeImageText` | Episode title (override) → `customBigText` → release date → `"MPC-HC"` |
| `smallImageKey` | Pause icon |
 
### Idle / Stopped State
 
Shows `"Idling"` with the MPC-HC logo and `"Nothing is playing"`.
 
---

## FAQ

**Does it work without a TMDb account?**\
Yes. A shared built-in token is included. You only need your own token if you hit rate limits or want private access.

**Does it work with other media player?**\
Currently not, but it works with all Media Player Classic series.\
Just make sure port is same as [Enable MPC-HC Web Interface](https://github.com/butterbot6283/Discord-MPC-Rich-Presence/main/README.md#enable-mpc-hc-web-interface)
- [MPC-HC](https://github.com/clsid2/mpc-hc)
- [MPC-BE](https://github.com/Aleksoid1978/MPC-BE)
- [MPC-QT](https://github.com/mpc-qt/mpc-qt) (For Linux)

**Does the cache reset when I change settings?**\
Only API-affecting settings reset it (IDs, `dont`, `autoEpisode`, `autoPoster`, `autoDate`, `romajiTitle`, `cleanFilename`). Visual-only settings like `customText`, `customBigText`, `customImage`, and `slideshowInterval` update Discord instantly without clearing the cache.

**What if there are multiple `titles_sX.txt` files in the folder?**\
The script detects the conflict and skips all of them. Keep only one titles file per folder.

**Can I use this for anime?**\
Yes. Set `mal_id` in the folder's `mal.txt` or `config.json`. The script will fetch posters and titles from MyAnimeList via Jikan. For accurate episode ordering (e.g. Dragon Ball, One Piece), create a `group.txt` with the correct TMDb Episode Group ID.

**What is `dont`?**\
Don't ask

---

## Troubleshooting

**No Rich Presence showing on Discord:**
- Make sure Discord is running before starting the script.
- The script auto-reconnects every 5 seconds — wait a moment after opening Discord.
- Check that your Discord account has Rich Presence activity display enabled in privacy settings.

**Wrong poster or show title:**
- Check the console log under `[1. RAW INPUTS & DETEKSI ID]` to see which ID was used.
- Create a `tmdb.txt` or `mal.txt` in the video folder with the correct ID.
- Delete `rpc_cache.json` from the video folder to force a fresh API fetch.

**MPC-HC not detected:**
- Go to **MPC-HC → View → Options → Player → Web Interface** and enable it.
- Make sure the port is `13579` (default) and **"Allow access from localhost"** is checked.

**FFprobe errors or timeout:**
- Make sure `ffprobe` is installed and available in your `PATH`.
- The script gives FFprobe 3 seconds to respond. On very slow disks it may time out — this is non-fatal and the script falls back to filename parsing.

**Episode titles not showing:**
- Verify `titles.txt` format: `episode_number|title|release_date` with no extra spaces.
- Only one titles file is allowed per folder. Remove duplicates.
- Check that `autoEpisode` is `true` in your config for TMDb episode fetching.

**View live logs:**
```bash
npx pm2 logs index
```
Or use the menu: **Main Menu → View Live Log (PM2)**.

---

## Roadmap

- [ ] MAL episode title fetching via Jikan seasons endpoint
- [ ] Multi-monitor / multi-instance MPC-HC support
- [ ] Configurable Discord RPC activity type (Watching / Playing / Listening)
- [ ] Web UI for config editing instead of CLI menu

---

## Credits

Script created with AI assistance through testing and prompting by [butterbot6283](https://github.com/butterbot6283).

Libraries used:
- [@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc)
- [axios](https://axios-http.com/)
- [@ctrl/video-filename-parser](https://github.com/ctrl/video-filename-parser)
- [pm2](https://pm2.keymetrics.io/)
- [TMDb API](https://developer.themoviedb.org/)
- [Jikan API](https://jikan.moe/) (unofficial MyAnimeList API)

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

