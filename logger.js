// logger.js
// File ini bertanggung jawab untuk semua output ke console/terminal.

const { execSync } = require('child_process');

let updateEventCount = 0;
let lastLoggedState = null;
let mpcOfflineLogged = false;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAS CONSOLE
// ─────────────────────────────────────────────────────────────────────────────

// Membersihkan terminal secara menyeluruh sesuai platform OS
function deepClearConsole() {
    try {
        if (process.platform === 'linux') {
            process.stdout.write('\x1b_Ga=d\x1b\\');
            execSync('clear', { stdio: 'inherit' });
        } else if (process.platform === 'win32') {
            // Gunakan Escape Code ANSI murni agar terminal Windows tersapu bersih
            process.stdout.write('\x1Bc');
        } else {
            console.clear();
        }
    } catch (e) {
        console.clear();
    }
}

// Hitung update log, lalu bersihkan console otomatis jika sudah 10x agar tidak penuh
function checkClearConsole() {
    if (updateEventCount >= 10) {
        deepClearConsole();
        console.log('🧹 Console auto-cleared (10 update limit reached)...');
        updateEventCount = 0;
    }
    updateEventCount++;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Fungsi kecil untuk membuat baris status yang seragam
// Contoh output: "   - FFprobe      : ✅ Metadata found (Title, TMDb ID)"
// ─────────────────────────────────────────────────────────────────────────────
function statusLine(label, icon, message) {
    // Pad label ke 14 karakter agar semua kolom rata
    const paddedLabel = label.padEnd(14, ' ');
    return `   - ${paddedLabel}: ${icon} ${message}`;
}

// Bangun teks "(year: 2014)" untuk baris Search Query. Simpel saja karena info
// match/tidaknya tahun sekarang sudah tercermin lewat retry notes (lihat isRetryNote di bawah).
function buildYearStr(year) {
    return year ? ` (year: ${year})` : '';
}

// metadata.js sekarang pakai "cascade search" (coba beberapa kombinasi tahun/tipe/judul
// sebelum menyerah) dan menaruh catatan setiap percobaan itu ke debugInfo.apiErrors juga.
// Fungsi ini membedakan mana yang catatan retry (bukan kegagalan) vs error API asli,
// supaya retry yang berujung SUKSES tidak dilaporkan sebagai "request failed".
function isRetryNote(msg) {
    return msg.startsWith('Strict year match failed.') || msg.startsWith('No results for ');
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG UTAMA: Siap terhubung ke Discord
// ─────────────────────────────────────────────────────────────────────────────
function logReady(clientId) {
    deepClearConsole();
    console.log(`✅ Connected to Discord (RPC Ready) — clientId: ${clientId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG UTAMA: MPC-HC tidak terdeteksi / offline
// Hanya cetak sekali sampai MPC-HC hidup lagi (flag mpcOfflineLogged)
// ─────────────────────────────────────────────────────────────────────────────
function logOffline() {
    if (!mpcOfflineLogged) {
        deepClearConsole();
        console.log('⏳ MPC-HC is closed or not running. Waiting for player...');
        mpcOfflineLogged = true;
        updateEventCount = 0;
        lastLoggedState = null;
    }
}

function resetOfflineStatus() {
    mpcOfflineLogged = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG UTAMA: Error tak terduga saat menghubungi MPC-HC (BUKAN sekadar "MPC-HC tertutup")
// Contoh: web interface mengirim HTML tidak terduga, error jaringan lokal, dll
// ─────────────────────────────────────────────────────────────────────────────
function logMpcError(errorCode, errorMessage) {
    console.log(`\n❌ [MPC-HC ERROR] Unexpected error while contacting MPC-HC web interface`);
    console.log(`   Code    : ${errorCode || 'UNKNOWN'}`);
    console.log(`   Message : ${errorMessage || '(no message)'}`);
    console.log(`   💡 Tip: Check that the Web Interface port (13579) isn't blocked or used by another app.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG UTAMA: Media baru terdeteksi
// Ini adalah log paling penting — cetak seluruh pipeline dari awal sampai akhir
// ─────────────────────────────────────────────────────────────────────────────
function logNewMedia(mpcStatus, activityPayload, debugData, config) {
    checkClearConsole();

    // ── Variabel Bantu ────────────────────────────────────────────────────────
    const isGroup    = !!mpcStatus.groupID;
    const sourceInfo = debugData.cachedPosterSource || 'Not Found';
    const isCache    = sourceInfo.includes('[CACHE]');
    const cleanSource = sourceInfo.replace('[CACHE] ', '');

    // Tentukan apakah setiap step berhasil atau gagal untuk badge ✅/⚠️/❌
    // DIPERBAIKI: referensi debugIds.txt.mal dihapus (Jikan/MAL sudah tidak dipakai)
    const txtOk    = mpcStatus.debugIds?.txt?.tmdb || mpcStatus.debugIds?.txt?.group;
    const posterOk = cleanSource !== 'Not Found' && cleanSource !== 'Error' && debugData.cachedPosterSource;
    const allSearchNotes = debugData.cachedPosterDebug?.apiErrors || [];
    const retryNotes = allSearchNotes.filter(isRetryNote);
    const apiErrors = allSearchNotes.filter(msg => !isRetryNote(msg));

    // ── Header ────────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(56)}`);
    console.log(`🎬 NEW MEDIA DETECTED`);
    console.log(`   ${mpcStatus.rawFileName}`);
    console.log(`${'═'.repeat(56)}`);

    // ── Blok Config Override ──────────────────────────────────────────────────
    // Tampilkan hanya jika ada override aktif dari config.json
    // DIPERBAIKI: config.mal_id dihapus dari kondisi & baris Manual ID
    const hasOverride = config.customText || config.customBigText || debugData.customImageURL
    || config.tmdb_id;
    if (hasOverride) {
        console.log(`\n⚙️  [CONFIG OVERRIDES ACTIVE]`);
        if (config.customText)       console.log(`   - customText    : "${config.customText}"`);
        if (config.customBigText)    console.log(`   - customBigText : "${config.customBigText}"`);
        if (debugData.customImageURL)console.log(`   - customImage   : Custom image URL in use`);
        if (config.tmdb_id)
            console.log(`   - Manual ID     : TMDb=${config.tmdb_id}`);
    }

    // ── Blok 1: Input Mentah & Resolusi ID ───────────────────────────────────
    console.log(`\n📦 [1. RAW INPUT & ID RESOLUTION]`);
    console.log(`   - Raw File      : ${mpcStatus.rawFileName}`);
    console.log(`   - Clean File    : ${mpcStatus.fileName}`);
    console.log(`   - Order Mode    : ${isGroup ? '👥 EPISODE GROUP (absolute order)' : '📺 SEASON (standard order)'}`);

    // ── Sub-blok 1a: FFprobe ──────────────────────────────────────────────────
    // FFprobe di sini HANYA membaca title tag dari file video.
    // ID (TMDb) dan tanggal rilis TIDAK diambil dari metadata video.
    const ffprobeStatus = mpcStatus.ffprobeStatus || { failed: false };
    if (ffprobeStatus.failed && ffprobeStatus.errorType === 'timeout') {
        // FFprobe tidak menjawab dalam 3 detik (disk lambat / file di jaringan)
        console.log(statusLine('FFprobe', '⏱️', 'Timed out (>3s) — falling back to filename'));
    } else if (ffprobeStatus.failed && ffprobeStatus.errorType === 'not_installed') {
        // ffprobe tidak ditemukan sama sekali di PATH sistem
        console.log(statusLine('FFprobe', '❌', 'Not found in system PATH — install FFmpeg to enable title reading'));
    } else if (ffprobeStatus.failed) {
        // Error lain: file corrupt, permission denied, dll
        console.log(statusLine('FFprobe', '⚠️', 'Failed to read metadata (corrupt file or permission issue)'));
    } else if (!mpcStatus.isFallback && mpcStatus.title) {
        // Title tag ditemukan dan dipakai
        console.log(statusLine('FFprobe', '✅', `Title tag found: "${mpcStatus.title}"`));
    } else {
        // Tidak ada title tag — fallback ke nama file
        console.log(statusLine('FFprobe', '—', 'No title tag in file — using filename as title'));
    }

    // ── Sub-blok 1b: TXT Files ────────────────────────────────────────────────
    // Cetak hasil baca tmdb.txt / group.txt dari folder video (prioritas ID pertama)
    // DIPERBAIKI: baris MAL dihapus dari txtFound
    if (txtOk) {
        const txtFound = [];
        if (mpcStatus.debugIds?.txt?.tmdb)  txtFound.push(`TMDb: ${mpcStatus.debugIds.txt.tmdb}`);
        if (mpcStatus.debugIds?.txt?.group) txtFound.push(`Group: ${mpcStatus.debugIds.txt.group}`);
        console.log(statusLine('Folder TXT', '✅', txtFound.join(' · ')));
    } else if (mpcStatus.filePath) {
        // File ada tapi tidak ada txt — ini normal, bukan error keras
        console.log(statusLine('Folder TXT', '—', 'No tmdb.txt / group.txt in video folder'));
    }

    // ── Sub-blok 1c: Ringkasan ID Akhir ──────────────────────────────────────
    // DIPERBAIKI: finalMal dihapus dari ringkasan ID
    const finalTmdb  = mpcStatus.tmdbID  || '—';
    const finalGroup = mpcStatus.groupID || '—';
    console.log(`   - Final IDs     : TMDb=${finalTmdb} | Group=${finalGroup}`);
    console.log(`   - ID Source     : ${debugData.idSource}`);

    // ── Blok 2: Fetch & Cache ─────────────────────────────────────────────────
    console.log(`\n📡 [2. POSTER FETCH & CACHE]`);

    if (debugData.customImageURL) {
        // customImage dipakai — tidak perlu fetch sama sekali
        console.log(statusLine('Method', '🖼️', 'Custom image override — fetch skipped'));
    } else if (!config.autoPoster) {
        // autoPoster dimatikan oleh user
        console.log(statusLine('Method', '—', 'autoPoster is OFF — fetch skipped'));
    } else if (isCache) {
        // Data dimuat dari cache lokal, tidak ada API call
        console.log(statusLine('Method', '📂', 'Loaded from local cache (0 API calls ⚡)'));
        console.log(statusLine('Cache Source', '✅', cleanSource));
    } else if (posterOk) {
        // Fetch berhasil dari API
        console.log(statusLine('Method', '🌐', 'Fetched from API (online)'));
        console.log(statusLine('API Source', '✅', cleanSource));

        // Kalau cascade search butuh beberapa percobaan sebelum ketemu (mis. coba tanpa tahun,
        // coba tanpa indikator season, dll), tampilkan jejaknya biar kelihatan kenapa agak lama
        if (retryNotes.length > 0) {
            retryNotes.forEach(msg => console.log(statusLine('  ↳ Retry', '🔁', msg)));
        }

        // Jika autoPoster mencari via nama file, tampilkan keyword yang dipakai
        if (debugData.cachedPosterDebug?.searchedTmdb) {
            const yearStr = buildYearStr(debugData.cachedPosterDebug.year);
            console.log(statusLine('Search Query', '🔍', `"${debugData.cachedPosterDebug.cleanTitle}"${yearStr}`));
        }

        // Tampilkan berapa poster yang ditemukan dan mode pemilihan
        const posterCount = debugData.posterCount ?? 0;
        if (posterCount > 0) {
            const modeStr = config.randomPoster ? 'random pick' : 'first pick';
            console.log(statusLine('Posters', '✅', `${posterCount} poster(s) available — ${modeStr}`));
        }
    } else {
        // Fetch dijalankan tapi tidak menemukan apa-apa
        console.log(statusLine('Method', '🌐', 'Fetched from API (online)'));

        // Bedakan antara "error jaringan/timeout nyata" dan "sudah dicoba beberapa cara tapi genuinely tidak ketemu"
        if (cleanSource === 'Error' || apiErrors.length > 0) {
            console.log(statusLine('API Result', '❌', 'Request failed — falling back to MPC-HC logo'));
            // Cetak setiap error nyata yang tertangkap dari metadata.js (mis. ECONNABORTED, timeout, 500)
            apiErrors.forEach(msg => {
                console.log(statusLine('  ↳ Error', '❌', msg));
            });
        } else {
            // autoPoster ON tapi genuinely tidak ada hasil: tampilkan keyword yang sudah dicoba
            if (debugData.cachedPosterDebug?.searchedTmdb) {
                const yearStr = buildYearStr(debugData.cachedPosterDebug.year);
                console.log(statusLine('Search Query', '🔍', `"${debugData.cachedPosterDebug.cleanTitle}"${yearStr}`));
            }

            if (retryNotes.length > 0) {
                // Sudah dicoba beberapa kombinasi (tanpa tahun, tanpa indikator season, dll) tapi tetap nihil
                console.log(statusLine('API Result', '⚠️', `No matching title found after ${retryNotes.length + 1} attempt(s) — falling back to MPC-HC logo`));
                retryNotes.forEach(msg => console.log(statusLine('  ↳ Retry', '🔁', msg)));
            } else {
                console.log(statusLine('API Result', '⚠️', 'No matching title found — falling back to MPC-HC logo'));
            }

            // Saran perbaikan agar user tahu langkah selanjutnya
            console.log(`   ${'─'.repeat(50)}`);
            console.log(`   💡 Tip: If the wrong poster shows or nothing was found,`);
            console.log(`      place a tmdb.txt file in the video folder with the correct TMDb ID.`);
            console.log(`   ${'─'.repeat(50)}`);
        }
    }

    // ── Blok 3: Resolusi Judul & Episode ─────────────────────────────────────
    console.log(`\n🍳 [3. TITLE & EPISODE RESOLUTION]`);

    // ── Sub-blok 3a: Judul tampil (details) ──────────────────────────────────
    console.log(`   - Title         : ${debugData.titleSource}`);

    // ── Sub-blok 3b: Episode title ────────────────────────────────────────────
    if (debugData.fetchedEpisodeTitle) {
        // Ditemukan dari file titles.txt / titles_sX.txt
        const srcFile = debugData.cachedFetchedTitles?.debugInfo?.titlesFile || 'titles.txt';
        console.log(statusLine('Episode', '✅', `"${debugData.fetchedEpisodeTitle}" (via ${srcFile})`));
    } else if (debugData.cachedApiEpisodeTitle) {
        // Ditemukan dari API TMDb
        console.log(statusLine('Episode', '✅', `"${debugData.cachedApiEpisodeTitle}" (via TMDb API)`));
    } else if (!config.autoEpisode) {
        // autoEpisode dimatikan
        console.log(statusLine('Episode', '—', 'autoEpisode is OFF'));
    } else if (debugData.cachedFetchedTitles?.debugInfo?.loadedCount > 0) {
        // File titles.txt ada dan terbaca, tapi nomor episode tidak cocok
        const parsedEp = debugData.cachedFetchedTitles?.debugInfo?.parsedEpisode;
        const srcFile  = debugData.cachedFetchedTitles?.debugInfo?.titlesFile || 'titles.txt';
        if (parsedEp) {
            console.log(statusLine('Episode', '⚠️', `titles.txt loaded but episode ${parsedEp} not found in ${srcFile}`));
        } else {
            console.log(statusLine('Episode', '⚠️', `titles.txt loaded but no episode number detected in filename`));
        }
        console.log(`   ${'─'.repeat(50)}`);
        console.log(`   💡 Tip: Make sure your filename has a recognizable episode number,`);
        console.log(`      e.g. "Show Name - 01.mkv" or "S01E01 Title.mkv"`);
        console.log(`   ${'─'.repeat(50)}`);
    } else if (mpcStatus.tmdbID || config.tmdb_id) {
        // Ada ID tapi TMDb tidak mengembalikan judul episode
        // DIPERBAIKI: mpcStatus.malID / config.mal_id dihapus dari kondisi ini
        const parsedEp = debugData.cachedFetchedTitles?.debugInfo?.parsedEpisode;
        if (!parsedEp) {
            // Tidak ada nomor episode yang terbaca dari nama file
            console.log(statusLine('Episode', '⚠️', 'No episode number detected in filename — episode title skipped'));
        } else {
            // Nomor episode terbaca tapi TMDb tidak punya data untuk episode itu
            console.log(statusLine('Episode', '⚠️', `Episode ${parsedEp} not found in TMDb — no titles.txt in folder either`));
        }
    } else {
        // Tidak ada ID, tidak ada titles.txt, autoEpisode tidak bisa berbuat apa-apa
        console.log(statusLine('Episode', '—', 'No ID and no titles.txt — episode title unavailable'));
    }

    // ── Sub-blok 3c: Gambar & Big Text ───────────────────────────────────────
    console.log(`   - Image         : ${debugData.imageSource}`);
    console.log(`   - Large Text    : ${debugData.bigTextSource}`);

    // ── Blok 4: Payload Akhir ─────────────────────────────────────────────────
    console.log(`\n🚀 [4. FINAL DISCORD PAYLOAD]`);
    console.log(JSON.stringify(activityPayload, null, 2));
    console.log(`${'═'.repeat(56)}\n`);

    lastLoggedState = mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG STATE BERUBAH: Play ↔ Pause ↔ Stop (bukan media baru)
// Hanya cetak jika state benar-benar berubah dari sebelumnya
// ─────────────────────────────────────────────────────────────────────────────
function logStateUpdate(currentMediaState, activityPayload) {
    if (currentMediaState !== lastLoggedState) {
        checkClearConsole();
        console.log(`\n⏯️  [STATE CHANGE] → ${currentMediaState}`);
        console.log(`   Payload sent:`);
        console.log(JSON.stringify(activityPayload, null, 2));
        console.log(`${'─'.repeat(56)}\n`);
        lastLoggedState = currentMediaState;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG CONFIG BERUBAH: Dipanggil dari presence.js saat fs.watch mendeteksi edit
// Dua varian: API settings (perlu reset cache) vs visual-only settings
// ─────────────────────────────────────────────────────────────────────────────
function logConfigChanged(changedKeys, isApiChange) {
    console.log(`\n🔄 [LIVE CONFIG] Change detected from menu.js`);
    if (changedKeys && changedKeys.length > 0) {
        console.log(`   Changed keys    : ${changedKeys.join(', ')}`);
    }
    if (isApiChange) {
        console.log(`   ⚙️  API settings changed — resetting TMDb cache and re-fetching...`);
    } else {
        console.log(`   🎨 Visual settings changed — updating Discord display...`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TXT WATCHER: Dipanggil dari presence.js saat file .txt di folder berubah
// ─────────────────────────────────────────────────────────────────────────────
function logTxtWatcherEvent(filename) {
    console.log(`\n🔄 [TXT WATCHER] "${filename}" changed — reloading data...`);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG DISCORD: Pesan koneksi dari index.js
// ─────────────────────────────────────────────────────────────────────────────
function logDiscordWaiting() {
    console.log('⏳ Waiting for Discord... (will connect automatically when Discord opens)');
}

function logDiscordDisconnected() {
    console.log('\n⚠️  Disconnected from Discord! Waiting for Discord to reopen...');
}

module.exports = {
    logReady,
    logOffline,
    resetOfflineStatus,
    logNewMedia,
    logStateUpdate,
    logMpcError,
    logConfigChanged,
    logTxtWatcherEvent,
    logDiscordWaiting,
    logDiscordDisconnected,
};
