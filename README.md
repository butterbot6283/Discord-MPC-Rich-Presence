# Discord MPC Rich Presence

A Node.js script that shows **Media Player Classic** playback in Discord Rich Presence.

It can:
- detect the video title from FFprobe or the filename
- fetch posters and metadata from TMDb
- resolve Japanese anime season titles through AniList
- show local episode titles from `.txt` files
- rotate posters or custom images
- cache API results locally
- reload `config.json` and folder metadata without restarting the player

## Preview

### Playing

<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/11bef610-d18a-45b5-86d4-bedc46b691a1" /> <img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/f07add1f-28a7-4461-81ef-0c6aff68bbcc" />

---
### Paused

<img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/20c238f8-1008-4165-973f-ba1bd2c7f625" />

---
### Idle

<table>
  <tr>
    <th align="left">MPC-HC</th>
    <th align="left">MPC-BE</th>
  </tr>
  <tr>
    <td>
      <img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/636b65c0-32c2-4533-8b5d-af70ac4e7db5" />
    </td>
    <td>
      <img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/fceb36f4-ed90-4590-ad0d-d6a46db8730d" />
    </td>
  </tr>
  <tr>
    <th align="left">MPC-QT (Linux)</th>
  </tr>
  <tr>
    <td>
      <img width="415" height="149" alt="image" src="https://github.com/user-attachments/assets/80c98ebc-501d-4028-9894-69ee085d52b5" />
    </td>
  </tr>
</table>

---
## Requirements

Install these before running the script:

- **[Node.js](https://nodejs.org/en/download) v18+ with npm**
- **Media Player Classic**: [MPC-HC](https://github.com/clsid2/mpc-hc), [MPC-BE](https://github.com/Aleksoid1978/MPC-BE), or [MPC-QT](https://github.com/mpc-qt/mpc-qt)
- **FFprobe** from [FFmpeg](https://www.ffmpeg.org), available in `PATH`
- **Discord**
- **Internet access** for TMDb and AniList lookups

Install the Node.js packages with:

```bash
npm install
```

Main packages:

- `@xhayper/discord-rpc`
- `axios`
- `@ctrl/video-filename-parser`
- `pm2`

AniList uses its GraphQL API through the existing HTTP client, so it does not need a separate npm package.

## Installation

### Windows

```bat
git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
cd Discord-MPC-Rich-Presence
npm install
```

Start the menu by double-clicking:

```text
menu-windows.vbs
```

The VBS launcher opens the Windows Forms menu without an extra Node.js console window.

### Linux

```bash
git clone https://github.com/butterbot6283/Discord-MPC-Rich-Presence.git
cd Discord-MPC-Rich-Presence
npm install
```

On KDE Plasma, run or double-click:

```bash
./menu-linux-kde.sh
```

The launcher opens the KDE dialog menu through `kdialog`.

## First Setup

### 1. Enable the MPC Web Interface

Open:

**MPC-HC/BE/QT → View → Options → Player → Web Interface**

Enable the Web Interface and allow localhost access.

Default port:

```text
13579
```

### 2. Check FFprobe

```bash
ffprobe -version
```

If the command fails, install FFmpeg and make sure its `bin` directory is in `PATH`.

### 3. Start the script

You can use the graphical menu or run:

```bash
node menu.js
```

The terminal version uses a readline menu.

## Menu

`menu.js` provides the same functions across the available interfaces:

| Platform | Launcher | Interface |
|---|---|---|
| Windows | `menu-windows.vbs` | Windows Forms |
| Linux KDE | `menu-linux-kde.sh` | KDialog |
| Any platform | `node menu.js` | Terminal |

Use the menu to:

- start or stop the PM2 process
- view live logs
- edit configuration
- edit switches
- edit custom images and slideshow settings
- edit filename-cleaning rules

## TMDb Setup

The project includes a shared TMDb token.

You can add your own TMDb Bearer token for higher rate limits:

1. Create a token at [TMDb API settings](https://www.themoviedb.org/settings/api).
2. Put it in `config.json` as `personal_tmdb_token`.
3. You can also change it from the menu.

```json
{
  "personal_tmdb_token": ""
}
```

## How Metadata Lookup Works

The script checks metadata in this order:

1. Folder files such as `tmdb.txt` and `group.txt`
2. `tmdb_id` in `config.json`
3. Automatic search from the filename

FFprobe only reads the embedded video `title` tag. It does not supply the TMDb ID, AniList ID, or release date.

When the script cannot find a title tag, it uses the filename.

### Filename Search

When the folder has no TMDb ID, the script tries several searches:

1. cleaned title + year
2. cleaned title
3. the other media type, TV or Movie
4. the title without explicit season markers such as `S2`, `Season 2`, `Part 2`, or `Cour 2`
5. the title without a trailing standalone number or Roman numeral

The terminal log shows each search attempt.

## Anime Titles with AniList

TMDb and AniList organize anime seasons differently.

A TMDb TV show can contain several seasons, while AniList can store each sequel as its own entry. For example:

```text
TMDb: Monogatari Series
├─ Season 1 → Bakemonogatari
├─ Season 2 → Nisemonogatari
└─ Season 3 → ...
```

Enable:

```json
"romajiTitle": true
```

For Japanese anime, the script then uses AniList to find the entry that matches the TMDb season.

### How the match works

Without `mal.txt`, the script compares:

- TMDb season first episode date
- AniList `startDate`
- AniList media format

The premiere date must match exactly. The resolver does not take the first AniList search result.

For Season 0, the resolver prefers OVA, ONA, and Special formats. For normal seasons, it avoids those formats.

### `mal.txt`

For a difficult franchise, put the MAL ID of the exact anime entry in the video folder:

```text
30831
```

The script uses that ID directly with AniList.

This avoids filename and premiere-date matching and works well for sequels with different titles.

When the AniList title resolves successfully, the RPC link uses the MAL URL.

## Episode Titles

The script supports local episode title files.

### `titles.txt`

Use:

```text
episode_number|title|release_date
```

Example:

```text
1|Pilot|2008-01-20
2|Episode Two|2008-01-27
```

The RPC shows:

```text
Episode 01: Pilot
Episode 02: Episode Two
```

### `titles_sX.txt`

Use a season-specific file such as:

```text
titles_s2.txt
```

Example:

```text
1|Seven Thirty-Seven|2009-03-08
2|Down|2009-03-15
```

The RPC shows:

```text
S02E01: Seven Thirty-Seven
S02E02: Down
```

The season in `titles_sX.txt` takes priority over the season parsed from the filename.

Keep only one titles file in a folder. Multiple title files make the folder ambiguous, so the script skips them.

### TMDb Episode Titles

When `autoEpisode` is enabled, TMDb episode formatting follows the season:

| Season | Format |
|---|---|
| 0 | `Special Episode X: Title` |
| 1 | `Episode X: Title` |
| 2+ | `S0XE0X: Title` |

The local `titles.txt` and `titles_sX.txt` formats stay unchanged.

## Folder Metadata Files

Put these files next to the videos.

### `tmdb.txt`

Contains one TMDb ID:

```text
65844
```

<img width="1038" height="453" alt="image" src="https://github.com/user-attachments/assets/359501f0-ba9f-413c-9756-ca24a412990b" />

### `group.txt`

Contains a TMDb Episode Group ID for alternate episode ordering:

```text
69afde2c03e49b16d980f4d7
```

<img width="1038" height="453" alt="image" src="https://github.com/user-attachments/assets/4d51fcf5-a824-4cb7-b083-025eb8b93a73" />

### `mal.txt`

Contains one MyAnimeList ID for AniList resolution:

```text
30831
```

<img width="1038" height="453" alt="image" src="https://github.com/user-attachments/assets/efddfa54-fe87-45be-8874-ec5e26bcd6f9" />

### `titles.txt`

Generic episode list:

```text
1|Episode One|2026-01-01
2|Episode Two|2026-01-08
```

### `titles_sX.txt`

Season-specific episode list:

```text
1|Episode One|2026-01-01
2|Episode Two|2026-01-08
```

Use the filename `titles_s2.txt`, `titles_s3.txt`, and so on for the target season.

## Configuration

The main configuration file is `config.json`.

Example:

```json
{
    "personal_tmdb_token": "",
    "tmdb_id": "",
    "customText": "",
    "customBigText": "",
    "autoPoster": false,
    "autoEpisode": false,
    "autoDate": false,
    "cleanFilename": true,
    "romajiTitle": false,
    "randomPoster": false,
    "slideshowInterval": 0,
    "dont": "okay",
    "customImage": [
        ""
    ],
    "cleanRegex": [
        "\\b(2160p|1080p|1080i|720p|480p|360p|4K|8K|UHD|FHD|HD)\\b",
        "\\b(BluRay|Blu-Ray|BRRip|BDRip|BDR|WEBRip|WEB-DL|WEB-HD|WEBDL|HDRip|HDTV|PDTV|DVDRip|DVDScr|CAM|TS|TC|VODRip)\\b",
        "\\b(x264|x265|H\\.?264|H\\.?265|HEVC|AVC|DivX|XviD|10-?bit|8-?bit|12-?bit|HDR(?:10)?|DV|Dolby\\s*Vision|SDR)\\b",
        "\\b(AAC|AC3|EAC3|DTS(?:-HD)?|FLAC|TrueHD|Atmos|DD\\.?5\\.1|DD\\.?7\\.1|Dual[- ]Audio|Opus|MP3|2CH|6CH)\\b",
        "\\b\\d+(?:\\.\\d+)?(?:MB|GB)\\b",
        "-?(Pahe\\.(in|ph)|PSA|YTS\\.[a-zA-Z]{2}|YIFY)",
        "[\\.\\-\\s]+(?=\\.(mkv|mp4|avi|flv)$)"
    ]
}
```

### Options

| Key | Type | Default | Description |
|---|---|---|---|
| `personal_tmdb_token` | string | `""` | Your TMDb Bearer token. |
| `tmdb_id` | string | `""` | Global TMDb ID override. |
| `customText` | string | `""` | Custom Discord `details` text. |
| `customBigText` | string | `""` | Overrides large image tooltip text. |
| `autoPoster` | bool | `false` | Enables automatic TMDb poster and metadata handling. |
| `autoEpisode` | bool | `false` | Fetches episode titles from TMDb. |
| `autoDate` | bool | `false` | Shows release dates from TMDb or local metadata. |
| `cleanFilename` | bool | `true` | Cleans filenames before searching. |
| `romajiTitle` | bool | `false` | Enables AniList anime title resolution. |
| `randomPoster` | bool | `false` | Randomizes poster or slideshow selection. |
| `slideshowInterval` | number | `0` | Slideshow interval in seconds. `0` disables it. |
| `dont` | string | `okay` | Internal option. |
| `customImage` | array | `[""]` | Custom image URLs. |
| `cleanRegex` | array | config | Extra filename-cleaning regex rules. |

## Posters and Slideshow

The script fetches and caches TMDb posters for each video.

### Poster selection

`randomPoster` controls which poster the script selects when a new video starts:

```json
"randomPoster": true
```

Selects a random poster.

```json
"randomPoster": false
```

Uses the first poster in the cached list.

This also works when the slideshow is disabled. `randomPoster` does **not** enable or disable the slideshow.

### Slideshow

`slideshowInterval` controls how often the current image changes. The value is in **seconds**.

```json
"slideshowInterval": 10
```

Changes the image every 10 seconds.

Set it to `0` to disable the slideshow:

```json
"slideshowInterval": 0
```

When the slideshow is disabled and `randomPoster` is true, the poster still changes when you play a different video.

### Custom images

You can use your own image URLs instead of TMDb posters:

```json
"customImage": [
    "https://example.com/image1.png",
    "https://example.com/image2.png"
]
```

With multiple custom images, the same `randomPoster` setting controls random or sequential rotation.

For Japanese anime with `romajiTitle` enabled, the script can also include Japanese-language TMDb posters in the cached poster list.

## Movie Display

When a movie has a TMDb tagline and `customBigText` is empty, the RPC uses:

```text
Large image text: tagline
Small image text: release date
```

Example:

```text
Large: One. Last. Ride.
Small: (Jun 25, 2026)
```

Without a tagline, the release date stays in the large image text.

## Live Reload

The script watches `config.json` and the metadata files in the current video's folder.

It watches:

```text
tmdb.txt
group.txt
titles.txt
titles_sX.txt
mal.txt
```

Save a change and the script reloads it while the video keeps playing or remains paused.

Display settings such as custom text, custom images, slideshow interval, and random poster selection can change without rebuilding cached API data.

Settings that change metadata lookup can trigger a fresh lookup.

## Cache

The script stores fetched metadata in:

```text
rpc_cache.json
```

It keeps the file next to the video when possible. If the video folder is not writable, it uses the project folder.

Cached data lets the script reuse previous TMDb and AniList results when display settings change.

## Discord Connection

`index.js` reconnects to Discord when the Discord client disconnects.

The script keeps trying until Discord becomes available again.

## Rich Presence

### Playing

| Field | Source |
|---|---|
| `name` | Resolved show title |
| `details` | Custom text, show title, or filename |
| `state` | Local episode title, TMDb title, or filename |
| `largeImageKey` | Custom image, TMDb poster, or default MPC image |
| `largeImageText` | Custom text, movie tagline/date, or episode/date |
| `detailsUrl` | TMDb URL, or MAL URL after AniList resolution |

### Paused

The presence refreshes about every 5 seconds while paused. This keeps slideshow changes, config changes, and folder metadata changes visible.

### Idle

When MPC stops playing, the RPC switches to an idle state with the default MPC image.

## Troubleshooting

### Wrong poster or show

Check the terminal log for the selected TMDb ID and search path.

You can force the correct media with:

```text
tmdb.txt
```

Remove the relevant `rpc_cache.json` when you need a fresh lookup.

### Wrong anime title

Check the AniList resolution details in the terminal log.

The resolver uses the TMDb season premiere date, AniList `startDate`, media format, and Japanese-language check.

For franchises with many separate entries, use `mal.txt`.

### Episode title does not appear

Check these items:

- `autoEpisode` is enabled for TMDb titles
- the local file uses `episode_number|title|release_date`
- only one titles file exists in the folder
- the filename contains an episode number when the script needs to parse it

### MPC is not detected

Enable the Web Interface and check the port.

Default:

```text
13579
```

### FFprobe fails

Run:

```bash
ffprobe -version
```

Make sure FFprobe is installed and available in `PATH`.

A timeout does not stop playback detection. The script falls back to filename parsing.

### View live logs

```bash
npx pm2 logs index
```

You can also open the logs from the menu.

## Credits

Created with AI assistance through testing and prompting by [butterbot6283](https://github.com/butterbot6283).

Libraries and services:

- [@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc)
- [axios](https://axios-http.com/)
- [@ctrl/video-filename-parser](https://github.com/ctrl/video-filename-parser)
- [pm2](https://pm2.keymetrics.io/)
- [TMDb API](https://developer.themoviedb.org/)
- [AniList GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
