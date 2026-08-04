// logger.js
const { execSync } = require('child_process');

let updateEventCount = 0; 
let lastLoggedState = null;
let mpcOfflineLogged = false;

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

function checkClearConsole() {
    if (updateEventCount >= 10) {
        deepClearConsole();
        console.log("🧹 Console dibersihkan otomatis (batas 10x update log tercapai)...");
        updateEventCount = 0;
    }
    updateEventCount++;
}

function logReady(clientId) {
    deepClearConsole();
    console.log(`Terhubung ke Discord (RPC Siap) - clientId: ${clientId}`);
}

function logOffline() {
    if (!mpcOfflineLogged) {
        deepClearConsole();
        console.log("⏳ MPC-HC ditutup atau belum dijalankan. Menunggu pemutar...");
        mpcOfflineLogged = true;
        updateEventCount = 0; 
        lastLoggedState = null;
    }
}

function resetOfflineStatus() {
    mpcOfflineLogged = false;
}

function logNewMedia(mpcStatus, activityPayload, debugData, config) {
    checkClearConsole(); 
                
    console.log(`\n==================================================`);
    console.log(`🎬 [NEW MEDIA DETECTED] : ${mpcStatus.rawFileName}`);
    console.log(`==================================================`);
    
    console.log(`⚙️  [STATUS CONFIG.JSON]`);
    let isConfigUsed = false;
    if (config.customText) { console.log(`   - customText    : OVERRIDE AKTIF -> "${config.customText}"`); isConfigUsed = true; }
    if (config.customBigText) { console.log(`   - customBigText : OVERRIDE AKTIF -> "${config.customBigText}"`); isConfigUsed = true; }
    if (debugData.customImageURL) { console.log(`   - customImage   : OVERRIDE AKTIF -> (Menggunakan Gambar Kustom)`); isConfigUsed = true; }
    if (config.tmdb_id || config.mal_id) { console.log(`   - Manual ID     : OVERRIDE AKTIF -> TMDb=${config.tmdb_id || '-'}, MAL=${config.mal_id || '-'}`); isConfigUsed = true; }
    if (!isConfigUsed) { console.log(`   - (Tidak ada pengaturan manual yang aktif, menggunakan mode otomatis)`); }

    console.log(`\n📦 [1. RAW INPUTS & DETEKSI ID]`);
    console.log(`   - File Asli   : ${mpcStatus.rawFileName}`);
    console.log(`   - Sumber ID   : ${debugData.idSource}`);
    console.log(`   - ID Terpakai : TMDb=${mpcStatus.tmdbID || 'null'}, MAL=${mpcStatus.malID || 'null'}`);
    
    console.log(`\n🍳 [2. PROSES MEMASAK & FALLBACK]`);
    if (debugData.fetchedEpisodeTitle) {
        let titleSrcFile = debugData.cachedFetchedTitles?.debugInfo?.titlesFile || "titles.txt";
        console.log(`   - Cek Episode : Sukses via ${titleSrcFile} -> "${debugData.fetchedEpisodeTitle}"`);
    } else if (debugData.cachedApiEpisodeTitle) {
        console.log(`   - Cek Episode : Sukses via API TMDb -> "${debugData.cachedApiEpisodeTitle}"`);
    } else if (debugData.cachedFetchedTitles?.debugInfo?.loadedCount > 0) {
        console.log(`   - Cek Episode : Gagal Fallback -> Angka episode tidak terbaca dari nama file`);
    } else {
        console.log(`   - Cek Episode : TIDAK DITEMUKAN -> (Tidak ada titles_sX.txt dan gagal API)`);
    }
    
    console.log(`   - Final Title : ${debugData.titleSource}`);

    if (config.autoPoster && debugData.cachedPosterDebug && !debugData.customImageURL) {
        const yearInfo = debugData.cachedPosterDebug.year ? `(Tahun: ${debugData.cachedPosterDebug.year})` : '';
        console.log(`   - AutoPoster  : Aktif -> Mencari: "${debugData.cachedPosterDebug.cleanTitle}" ${yearInfo}`);
        
        if (debugData.cachedPosterDebug.searchedTmdb) {
            const statusTmdb = (debugData.cachedPosterSource.includes('TMDb (AutoPoster')) ? 'Ketemu!' : 'Gagal / Tidak Ada';
            console.log(`                   > Cek TMDb... ${statusTmdb}`);
        }
    }

    console.log(`   - Final Image : ${debugData.imageSource}`);
    console.log(`   - Big Text    : ${debugData.bigTextSource}`);

    console.log(`\n🚀 [3. FINAL PAYLOAD (RPC DISCORD)]`);
    console.log(JSON.stringify(activityPayload, null, 2));
    console.log(`==================================================\n`);

    lastLoggedState = mpcStatus.isPlaying ? 'PLAYING' : (mpcStatus.isPaused ? 'PAUSED' : 'STOPPED');
}

function logStateUpdate(currentMediaState, activityPayload) {
    if (currentMediaState !== lastLoggedState) {
        checkClearConsole(); 
        console.log(`\n⏯️ [STATE UPDATE] -> ${currentMediaState}`);
        console.log(`   Payload Terkirim:`);
        console.log(JSON.stringify(activityPayload, null, 2));
        console.log(`--------------------------------------------------\n`);
        lastLoggedState = currentMediaState;
    }
}

module.exports = {
    logReady,
    logOffline,
    resetOfflineStatus,
    logNewMedia,
    logStateUpdate
};