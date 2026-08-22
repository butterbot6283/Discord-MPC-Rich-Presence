I can't code and English isn't my native language. This script was created with AI assistance; I mainly do testing and prompting. If you find this repo, please figure out how to use it yourself. This README is also written with AI assistance. I hope it is easy to understand.

# MPC Discord Presence

> A Node.js script to display **Media Player Classic (MPC-HC)** playback as a Discord Rich Presence — with automatic poster fetching, episode titles, TMDb integration, AniList anime title resolution, Romaji/season title support, slideshow, local caching, and live config reloading.

<div align="left">

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

Displays real-time playback status on your Discord profile. Shows the video title, current state (Playing/Paused/Idle), timestamps, poster/custom image, and a clickable metadata link when available.

The presence is refreshed continuously, including while **paused**, so slideshow rotation, config changes, and folder `.txt` edits can take effect without pressing Play again.

### Video Title Detection (via FFprobe)

Reads the embedded `title` tag from the video file using `ffprobe` with a 3-second timeout to prevent hangs.

FFprobe is only used for the embedded video title. **TMDb IDs, AniList IDs, and release dates are not taken from the video metadata.**

If no title tag is available, the script falls back to filename-based detection.

### AutoPoster Pipeline (TMDb)

TMDb remains the main metadata source for posters, show/movie information, episode titles, release dates, and taglines.

Lookup priority:

1. `tmdb.txt` / `group.txt` in the video's folder
2. `tmdb_id` in `config.json`
3. Filename search with the TMDb cascade search

Results are cached locally in `rpc_cache.json` inside the video folder, or in the project folder if the video folder is not writable.

The cache is designed to keep fetched metadata available even when display switches are changed. Visual switches such as `autoPoster`, `romajiTitle`, and `autoEpisode` do not need to re-download already cached metadata just to change the displayed result.

### Cascade Filename Search

When no TMDb ID is available, the script searches TMDb using a multi-stage cascade:

1. Cleaned title + parsed year
2. Cleaned title without year
3. Repeat the year/title attempts on the opposite media type (TV ↔ Movie)
4. Remove explicit season indicators such as `S2`, `Season 2`, `Part 2`, or `Cour 2`, then retry
5. As a last resort, remove a trailing standalone number or Roman numeral

Every retry can be shown in the structured terminal log so it is easier to diagnose a wrong match.

---

## AniList Anime Title Resolution

### Why AniList is used

TMDb and AniList organize anime seasons differently. TMDb commonly stores a franchise as one TV show with multiple seasons, while AniList usually stores each anime/sequel as a separate entry.

For example:

```text
TMDb
Monogatari Series
├─ Season 1 → Bakemonogatari
├─ Season 2 → Nisemonogatari
└─ Season 3 → ...
```

AniList can instead return separate entries such as `Bakemonogatari`, `Nisemonogatari`, and so on. `romajiTitle` therefore uses AniList to resolve the specific anime entry that corresponds to the TMDb season.

### `romajiTitle` behavior

- **`romajiTitle: false`**
  - Use the normal TMDb title or TMDb alternative title.
  - Keep the TMDb clickable URL.
- **`romajiTitle: true`**
  - For Japanese anime, try to resolve the season-specific AniList entry.
  - Use the AniList Romaji title when resolved.
  - Use the corresponding MAL URL when an `idMal` is available.
  - If AniList cannot be resolved, fall back to the TMDb title.
- AniList lookup is skipped when the TMDb media `original_language` is not `ja`.

### AniList matching

When there is no `mal.txt`, the resolver searches AniList by title and requires an **exact premiere date match** against the first episode date from TMDb:

```text
TMDb season first episode date
            │
            ▼
       AniList search
            │
            ├─ exact year
            ├─ exact month
            └─ exact day
            │
            ▼
      format filtering
            │
            ▼
   matching AniList entry
```

There is no loose date tolerance and no fallback to the first AniList search result. If no exact match is found, the AniList resolver fails safely and the title falls back to TMDb.

For Season 0, OVA/ONA/SPECIAL formats are preferred. For normal seasons, those special formats are avoided.

### Absolute MAL ID resolution with `mal.txt`

For anime folders that contain `mal.txt`, the ID inside the file is used as an **absolute AniList/MAL resolver**.

Example:

```text
39783
```

The script queries AniList by that MAL ID instead of guessing from the filename and premiere date. This is the most reliable method for franchises where sequel titles are very different.

The resolved AniList title and MAL ID are stored in the local cache and reused for later episodes in the same TMDb season.

### Episode formatting in AniList mode

When the displayed show title actually comes from AniList:

- **Season 0** → `Special Episode X: Title`
- **Season 1+** → `Episode X: Title`

When `romajiTitle` is enabled but the title falls back to a TMDb alternative title, the normal TMDb season formatting is kept instead (`S02E01: Title`, etc.).

### AniList cache hydration

AniList data is stored together with the normal TMDb metadata in `rpc_cache.json`. If an existing cache entry does not yet contain the AniList title for the requested season, the script can hydrate that entry without rebuilding all TMDb metadata.

## Season-Aware Episode Formatting

When episode titles come from TMDb (`autoEpisode`), the display format adapts to the season number:

- **Season 0** → `Special Episode X: Title`
- **Season 1** → `Episode X: Title`
- **Season 2 and up** → `S0XE0X: Title`

If a `titles_sX.txt` file exists in the video folder, its season number takes priority over the season parsed from the filename.

Episode titles from `titles.txt` / `titles_sX.txt` keep their own local-file formatting and are not rewritten by the TMDb season formatting rule.

---

## Movie Tagline & Release Date

When a TMDb tagline is available and `customBigText` is not set, the tagline is shown as the **large image text** and the release date moves to the **small image text**.

Example:

```text
Large text : "One. Last. Ride."
Small text : (Jun 25, 2026)
```

If no tagline is available, the release date remains in the large image text.

## Random Poster

When `randomPoster` is enabled, a random poster is selected from the cached TMDb poster list.

For normal media, the poster cache contains English and no-language posters. For Japanese anime, Japanese-language posters are also fetched and stored separately. When `romajiTitle` is enabled and `original_language === "ja"`, the Japanese posters are combined with the English/no-language posters for selection.

Japanese poster images are not fetched for non-Japanese media.

---

## Slideshow

Set `slideshowInterval` (seconds) to rotate through multiple custom images or TMDb posters.

- `randomPoster: true` → random rotation
- `randomPoster: false` → sequential rotation
- `slideshowInterval: 0` → disabled

The slideshow continues to work while the video is paused.

---

## Live Config Reload

`presence.js` watches `config.json` with `fs.watch`.

Changes are picked up automatically after the config file is saved.

API-affecting settings can reset metadata state and trigger a fresh lookup, while display-only changes can be applied without unnecessarily refetching metadata.

Examples of settings that can affect metadata resolution:

- `autoPoster`
- `autoEpisode`
- `autoDate`
- `romajiTitle`
- `dont`
- `tmdb_id`
- `cleanFilename`

Display-oriented settings include:

- `customText`
- `customBigText`
- `customImage`
- `slideshowInterval`
- `randomPoster`

---

## Live TXT Watcher

The script watches the currently playing video's folder for:

- `tmdb.txt`
- `group.txt`
- `titles.txt`
- `titles_sX.txt`
- `mal.txt`

Adding or editing these files triggers a reload automatically, including while paused.

---

## Auto Reconnect

`index.js` handles Discord connection lifecycle automatically.

If Discord disconnects, the old RPC client is cleaned up and a new connection attempt is made periodically until Discord is available again.

---

## Structured Logging

`logger.js` prints a detailed breakdown when new media is detected, including:

- Raw and cleaned filename
- Config overrides
- TMDb / group ID source
- Cache status
- Poster source
- Search / retry information
- Episode title source
- Display title source
- Final Discord payload

The logger also reports whether the visible show title came from TMDb or AniList when the relevant debug data is available.

The terminal is automatically cleared after a number of update events to keep the output readable.

---

## CLI Menu (`menu.js` / `menu.bat`)

An interactive terminal menu built with `readline`.

It can be used to:

- Start / stop the PM2 process
- View live logs
- Edit config options
- Apply changes without manually editing `config.json`

---

# Requirements

- **Node.js** v18 or higher
- **MPC-HC** with the Web Interface enabled (default port `13579`)
- **FFprobe** (part of FFmpeg) installed and available in `PATH`
- **Discord** running on the system
- Internet access for TMDb / AniList lookups
- npm packages installed with `npm install`

Main packages:

- `@xhayper/discord-rpc`
- `axios`
- `@ctrl/video-filename-parser`
- `pm2`

AniList is accessed through its GraphQL API using the existing HTTP client, so no separate AniList npm package is required.

---

# Installation

## Windows

```bat
git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
cd Discord-MPC-Rich-Presence
npm install
```

Then run `menu.bat`.

## Linux

```bash
git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
cd Discord-MPC-Rich-Presence
npm install
node --no-warnings menu.js
```

---

## Enable MPC-HC Web Interface

Open:

**MPC-HC → View → Options → Player → Web Interface**

Enable the Web Interface and allow localhost access.

The default port is:

```text
13579
```

---

## Install FFprobe

Install FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html) and make sure `ffprobe` is available in `PATH`.

Verify:

```bash
ffprobe -version
```

---

# TMDb API Setup

The script includes a built-in shared TMDb token.

For higher rate limits or your own API access, create a [TMDb API token](https://www.themoviedb.org/settings/api) and place it in:

```text
personal_tmdb_token
```

You can configure it through the menu or directly in `config.json`.

---

# Configuration

## `config.json`

```json
{
    "personal_tmdb_token": "",
    "tmdb_id": "",
    "customText": "",
    "customBigText": "",
    "autoPoster": true,
    "autoEpisode": true,
    "autoDate": true,
    "cleanFilename": true,
    "romajiTitle": false,
    "randomPoster": true,
    "slideshowInterval": 0,
    "dont": "okay",
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

## Every Option Explained

| Key | Type | Default | Description |
|---|---|---|---|
| `personal_tmdb_token` | string | `""` | Personal TMDb Bearer token. |
| `tmdb_id` | string | `""` | Global TMDb ID override. |
| `customText` | string | `""` | Custom Discord `details` text. |
| `customBigText` | string | `""` | Overrides large image tooltip text. |
| `autoPoster` | bool | `true` | Enables TMDb poster/show metadata and the normal show title display path. |
| `autoEpisode` | bool | `true` | Enables TMDb episode title fetching. |
| `autoDate` | bool | `true` | Enables release date display from TMDb/local metadata. |
| `cleanFilename` | bool | `true` | Enables filename cleaning and `cleanRegex`. |
| `romajiTitle` | bool | `false` | Enables the AniList anime title resolver and MAL link behavior when a Japanese anime is detected. |
| `randomPoster` | bool | `true` | Random poster / slideshow selection. |
| `slideshowInterval` | number | `0` | Slideshow interval in seconds. |
| `dont` | string | `okay` | Just Don't. |
| `customImage` | array | `[""]` | Custom image URLs used instead of the automatic poster. |
| `cleanRegex` | array | *(see config)* | Extra filename-cleaning regex patterns. |

---

# Folder Metadata

Place these files in the same folder as the video:

### `tmdb.txt`

Contains a single TMDb ID.

```text
1396
```

### `group.txt`

Contains a TMDb Episode Group ID for alternate episode ordering.

```text
69afde2c03e49b16d980f4d7
```

### `mal.txt`

Contains a single MyAnimeList ID used as an absolute AniList resolver for anime in that folder.

```text
39783
```

When present, the AniList lookup uses this ID directly instead of relying on filename/date matching. This is especially useful for sequels with different titles.

### `titles.txt`

Generic episode title file:

```text
episode_number|title|release_date
```

Example:

```text
1|Pilot|2008-01-20
2|Episode Two|2008-01-27
```

Displays episodes as:

```text
Episode 01: Pilot
Episode 02: Episode Two
```

### `titles_sX.txt`

Season-specific title file.

Example `titles_s2.txt`:

```text
1|Seven Thirty-Seven|2009-03-08
2|Down|2009-03-15
```

Displays:

```text
S02E01: Seven Thirty-Seven
S02E02: Down
```

The season number from `titles_sX.txt` can override the season parsed from the filename.

If multiple titles files are present in the same folder, the script skips them to avoid ambiguity.

---

# ID Priority Order

From highest to lowest:

1. Folder metadata (`tmdb.txt` / `group.txt`)
2. `config.json` (`tmdb_id`)
3. Automatic filename search

FFprobe is not used as an ID source.

---

# AutoPoster Pipeline

```text
New Media
   │
   ├─► Folder IDs
   │      ├─► tmdb.txt
   │      └─► group.txt
   │
   ├─► config.json
   │      └─► tmdb_id
   │
   └─► Filename Search
          │
          ├─► Title + year
          ├─► Title only
          ├─► TV ↔ Movie fallback
          ├─► Remove season marker
          └─► Remove trailing number / Roman numeral
                    │
                    ▼
                TMDb result
                    │
                    ▼
                Local cache
```

---

# Anime Title Resolution Pipeline

When `romajiTitle` is enabled and the media is Japanese anime:

```text
TMDb result
    │
    ├─► Parent / show title
    ├─► TMDb season
    └─► First episode air_date
             │
             ▼
       AniList search
             │
             ├─► Candidate list
             ├─► Start date matching
             └─► Format matching
                    │
                    ▼
            Matching AniList entry
                    │
                    ├─► AniList title
                    └─► MAL ID
                    │
                    ▼
             Discord Rich Presence
```

### Important

The AniList resolver does **not** assume that TMDb Season 1 corresponds to an AniList "Season 1".

Instead, it identifies the correct AniList entry by comparing the TMDb season's premiere date against AniList candidate `startDate` values, while using the AniList media format to avoid unrelated OVA/Special entries.

This is what allows one TMDb parent series to resolve to differently named AniList entries, for example:

```text
TMDb: Monogatari Series — Season 1
→ AniList: Bakemonogatari

TMDb: Monogatari Series — Season 2
→ AniList: Nisemonogatari
```

---

# Rich Presence Layout

## Playing State

| Field | Source |
|---|---|
| `name` | Resolved show title |
| `details` | Config custom text / show title / filename according to normal payload rules |
| `state` | Local episode title → TMDb episode title → filename |
| `largeImageKey` | Custom image → TMDb poster → default MPC-HC image |
| `largeImageText` | Custom big text → tagline/date for movies → episode/date fallback |
| `detailsUrl` | TMDb URL normally, or MAL URL when `romajiTitle` successfully resolves an AniList entry |

## Paused State

The presence continues to refresh approximately every 5 seconds, allowing slideshow rotation, configuration changes, and metadata changes to be reflected while paused.

## Idle / Stopped

Shows an idle state with the default MPC-HC image.

---

# FAQ

**Does it work without a TMDb account?**\
Yes. A shared built-in token is included. You only need your own token if you hit rate limits or want private access.

**Does it work with other media player?**\
No, but it works with all Media Player Classic series.\
Just make sure port is [13579](#enable-mpc-hc-web-interface)
- [MPC-HC](https://github.com/clsid2/mpc-hc)
- [MPC-BE](https://github.com/Aleksoid1978/MPC-BE)
- [MPC-QT](https://github.com/mpc-qt/mpc-qt) (For Linux)

**Does this work for anime?**\
Yes. TMDb remains the main metadata source. When `romajiTitle` is enabled and the media is Japanese anime, AniList is used to identify the specific anime entry and provide the season-specific title plus MAL ID.

**Why not simply search AniList and take the first result?**\
Because franchises can contain many separate AniList entries. A TMDb parent such as `Monogatari Series` can map to entries such as `Bakemonogatari` and `Nisemonogatari`. The TMDb season premiere date is used to determine which AniList entry represents the season currently being played.

**Does AniList replace TMDb?**\
No. TMDb remains the primary source for posters, episode metadata, release dates, and the main media lookup. AniList is used as the anime title/link resolver when `romajiTitle` is enabled.

**What happens if AniList lookup fails?**\
The Rich Presence continues using the existing fallback title path. AniList failure should not break normal TMDb playback information.

**Does changing `romajiTitle` require a complete refetch?**\
Not necessarily. Cached TMDb metadata and AniList information are reused when available. Older cache entries can be hydrated with AniList data when needed.

**Can this be used for western cartoons?**\
Yes. AniList lookup is skipped for media whose original TMDb language is not Japanese, even when `romajiTitle` is enabled.

**What is `mal.txt` used for?**\
Put the MAL ID of the anime entry in the same folder as the videos. When `romajiTitle` is enabled, that ID is used as the absolute AniList resolver instead of relying on filename/date matching.

**Does the cache reset whenever I change settings?**\
Only settings that affect metadata resolution need to invalidate metadata state. Display-only changes are designed to be applied without throwing away reusable cached API data.

**What is `dont`?**\
Don't ask

---

# Troubleshooting

### Wrong poster or wrong show

- Check the terminal log to see which TMDb ID or search path was used.
- Add a `tmdb.txt` file with the correct TMDb ID.
- Remove the relevant `rpc_cache.json` if a completely fresh lookup is required.

### Wrong anime title with `romajiTitle`

Check the terminal log for the AniList resolution path.

The important matching inputs are:

- TMDb season premiere date
- AniList `startDate`
- AniList media format
- Japanese-language guard

For difficult franchise structures such as Monogatari, verify that the TMDb season has the expected first-episode air date.

### Episode titles not showing

Make sure:

- `autoEpisode` is enabled for TMDb episode fetching
- `titles.txt` uses `episode_number|title|release_date`
- only one titles file exists in the folder
- the filename contains a recognizable episode number

### MPC-HC not detected

Enable the Web Interface and make sure the configured port matches the script (default `13579`).

### FFprobe timeout

Make sure `ffprobe` is installed and in `PATH`.

The timeout is non-fatal; the script can fall back to filename parsing.

### View live logs

```bash
npx pm2 logs index
```

Or use the CLI menu.

---

# Credits

Script created with AI assistance through testing and prompting by [butterbot6283](https://github.com/butterbot6283).

Libraries / services:

- [@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc)
- [axios](https://axios-http.com/)
- [@ctrl/video-filename-parser](https://github.com/ctrl/video-filename-parser)
- [pm2](https://pm2.keymetrics.io/)
- [TMDb API](https://developer.themoviedb.org/)
- [AniList GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/)

---

# License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
