#!/usr/bin/env node
// =====================================================================
// menu.js — MPC Discord Presence
//
// UI mode:
//   node menu.js                         -> TUI readline (terminal)
//   launch-menu-wgui.vbs on Windows     -> WinForms GUI
//   menu-gui.sh on Linux/KDE             -> KDialog GUI
//
// The launchers only select MPC_UI; all application/menu logic lives here.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync, spawn } = require('child_process');

const UI_MODE = (process.env.MPC_UI || 'tui').toLowerCase();
const IS_TUI = UI_MODE === 'tui';
const IS_WIN_GUI = UI_MODE === 'winforms';
const IS_KDIALOG = UI_MODE === 'kdialog';

if (!IS_TUI && !IS_WIN_GUI && !IS_KDIALOG) {
    console.error(`Unknown MPC_UI="${UI_MODE}". Falling back to TUI.`);
}

const EFFECTIVE_UI = (IS_WIN_GUI || IS_KDIALOG) ? UI_MODE : 'tui';
const IS_GUI = EFFECTIVE_UI !== 'tui';

const configPath = path.join(__dirname, 'config.json');
const APP_TITLE = 'MPC Discord Presence';
const helperScript = path.join(__dirname, 'gui-helper.ps1');

// ─────────────────────────────────────────────────────────────────────
// TUI: readline tetap aktif hanya kalau menu.js dijalankan langsung
// melalui terminal.
// ─────────────────────────────────────────────────────────────────────
let rl = null;
let question = null;

if (EFFECTIVE_UI === 'tui') {
    const readline = require('readline');
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    question = (query) => new Promise(resolve => rl.question(query, resolve));
}

// ─────────────────────────────────────────────────────────────────────
// GUI geometry untuk KDialog
// ─────────────────────────────────────────────────────────────────────
const WINDOW_W_RATIO = 900 / 1366;
const WINDOW_H_RATIO = 650 / 768;

function detectScreenSize() {
    if (EFFECTIVE_UI !== 'kdialog') return { w: 1366, h: 768 };

    try {
        const out = execSync('xrandr --current', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const m = out.match(/current\s+(\d+)\s*x\s*(\d+)/i);
        if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    } catch (e) {}

    try {
        const out = execSync('xdpyinfo', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const m = out.match(/dimensions:\s+(\d+)x(\d+)/);
        if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    } catch (e) {}

    return { w: 1366, h: 768 };
}

const SCREEN = detectScreenSize();
const WINDOW_W = Math.round(SCREEN.w * WINDOW_W_RATIO);
const WINDOW_H = Math.round(SCREEN.h * WINDOW_H_RATIO);
const GEOMETRY =
    `${WINDOW_W}x${WINDOW_H}+` +
    `${Math.round((SCREEN.w - WINDOW_W) / 2)}+${Math.round((SCREEN.h - WINDOW_H) / 2)}`;

// ─────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────
let config = {};

const defaultConfig = {
    personal_tmdb_token: "",
    tmdb_id: "",
    customText: "",
    customBigText: "",
    autoPoster: true,
    autoEpisode: true,
    autoDate: true,
    cleanFilename: true,
    romajiTitle: false,
    randomPoster: false,
    dont: "okay",
    slideshowInterval: 0,
    customImage: [""],
    cleanRegex: [
        "\\b(2160p|1080p|720p|480p)\\b",
        "\\b(BluRay|BRRip|BDRip|WEBRip|WEB-DL|WEB-HD|WEBDL|HDRip|HDTV|DVDRip|CAM|TS|TC)\\b",
        "\\b(x264|x265|H264|H265|HEVC|AAC|AC3|EAC3|DTS|FLAC|10bit|8bit)\\b",
        "\\b\\d{2,4}MB\\b",
        "\\b\\d{1,2}\\.\\d{1,2}GB\\b",
        "-?Pahe\\.in",
        "-?PSA",
        "-?YTS\\.[A-Z]{2}"
    ]
};

function ensurePowerShell() {
    const check = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']);
    if (check.error) {
        console.error('❌ powershell.exe tidak ditemukan di PATH.');
        process.exit(1);
    }
}

function b64(str) {
    return Buffer.from(str || '', 'utf-8').toString('base64');
}

function psCall(mode, { text = '', defaultValue = '', items = null } = {}) {
    const args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', helperScript,
        '-Mode', mode,
        '-TitleB64', b64(APP_TITLE),
        '-TextB64', b64(text),
        '-DefaultB64', b64(defaultValue)
    ];
    if (items) args.push('-ItemsB64', b64(JSON.stringify(items)));
    return spawnSync('powershell', args, { encoding: 'utf-8' });
}

function psMsgBox(text) { psCall('MsgBox', { text }); }
function psError(text) { psCall('Error', { text }); }

function psYesNo(text) {
    const res = psCall('YesNo', { text });
    return res.status === 0;
}

function psInputBox(promptText, currentValue) {
    const res = psCall('Input', {
        text: promptText,
        defaultValue: currentValue
    });
    if (res.status !== 0) return null;
    return res.stdout.toString().replace(/\r?\n$/, '');
}

function psMenu(promptText, items) {
    const itemObjs = items.map(([tag, label]) => ({ tag, label }));
    const res = psCall('Menu', { text: promptText, items: itemObjs });
    if (res.status !== 0) return null;
    return res.stdout.toString().replace(/\r?\n$/, '');
}

function psCheckList(promptText, items) {
    const itemObjs = items.map(([tag, label, checked]) => ({
        tag,
        label,
        checked: !!checked
    }));
    const res = psCall('Checklist', { text: promptText, items: itemObjs });
    if (res.status !== 0) return null;
    const out = res.stdout.toString().trim();
    if (out === '') return [];
    return out.split(/\r?\n/).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────
// KDIALOG
// ─────────────────────────────────────────────────────────────────────
function ensureKdialog() {
    const check = spawnSync('which', ['kdialog']);
    if (check.status !== 0) {
        console.error('❌ kdialog tidak ditemukan di sistem ini.');
        console.error('   Install: sudo pacman -S kdialog  (Arch)');
        process.exit(1);
    }
}

function mono(text) {
    const plain = String(text);

    // KDialog menerima markup HTML agar teks status/config bisa memakai
    // monospace + preserve whitespace. WinForms tidak merender HTML di
    // Label/ListBox, jadi HTML harus dikirim sebagai plain text di Windows.
    if (EFFECTIVE_UI !== 'kdialog') return plain;

    const escaped = plain
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return `<html><body style="text-align:left;"><pre style="font-family:monospace; white-space:pre; text-align:left; margin:0;">${escaped}</pre></body></html>`;
}

function kdMsgBox(text) {
    spawnSync('kdialog', [
        '--geometry', GEOMETRY,
        '--title', APP_TITLE,
        '--msgbox', text
    ]);
}

function kdError(text) {
    spawnSync('kdialog', [
        '--geometry', GEOMETRY,
        '--title', APP_TITLE,
        '--error', text
    ]);
}

function kdYesNo(text) {
    const res = spawnSync('kdialog', [
        '--geometry', GEOMETRY,
        '--title', APP_TITLE,
        '--yesno', text
    ]);
    return res.status === 0;
}

function kdInputBox(promptText, currentValue) {
    const res = spawnSync('kdialog', [
        '--geometry', GEOMETRY,
        '--title', APP_TITLE,
        '--inputbox', promptText, currentValue || ''
    ]);
    if (res.status !== 0) return null;
    return res.stdout.toString().replace(/\n$/, '');
}

function kdMenu(promptText, items) {
    const args = [
        '--geometry', GEOMETRY,
        '--title', APP_TITLE,
        '--menu', promptText
    ];
    items.forEach(([tag, label]) => args.push(tag, label));
    const res = spawnSync('kdialog', args);
    if (res.status !== 0) return null;
    return res.stdout.toString().replace(/\n$/, '');
}

function kdCheckList(promptText, items) {
    const args = [
        '--geometry', GEOMETRY,
        '--title', APP_TITLE,
        '--checklist', promptText
    ];
    items.forEach(([tag, label, checked]) => {
        args.push(tag, label, checked ? 'on' : 'off');
    });
    const res = spawnSync('kdialog', args);
    if (res.status !== 0) return null;

    const out = res.stdout.toString();
    return [...out.matchAll(/"([^"]*)"/g)].map(m => m[1]);
}

// ─────────────────────────────────────────────────────────────────────
// Common UI helpers
// ─────────────────────────────────────────────────────────────────────
function line(label, value) {
    return `${String(label).padEnd(18, ' ')}: ${value}`;
}

function getFullConfigText() {
    return [
        line('Personal TMDb', config.personal_tmdb_token ? 'Set (Hidden)' : 'Empty (Using Default)'),
        line('tmdb_id', `'${config.tmdb_id || ''}'`),
        line('customText', `'${config.customText || ''}'`),
        line('customBigText', `'${config.customBigText || ''}'`),
        line('Auto TMDb', `Poster(${config.autoPoster ? 'On' : 'Off'}) | Ep(${config.autoEpisode ? 'On' : 'Off'}) | Date(${config.autoDate ? 'On' : 'Off'})`),
        line('cleanFilename', config.cleanFilename),
        line('romajiTitle', config.romajiTitle),
        line('randomPoster', config.randomPoster),
        line("Don't", `'${config.dont}'`),
        line('slideshowInterval', `${config.slideshowInterval} seconds`),
        line('customImage', `[${config.customImage.length} URL]`),
        line('cleanRegex', `[${config.cleanRegex.length} rules]`)
    ].join('\n');
}

function buildFullConfigText() {
    return getFullConfigText();
}

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.personal_tmdb_token === undefined) config.personal_tmdb_token = '';
            if (config.tmdb_id === undefined) config.tmdb_id = config.imdb_id || '';
            if (config.romajiTitle === undefined) config.romajiTitle = false;
            if (config.randomPoster === undefined) config.randomPoster = true;
            if (config.dont === undefined) config.dont = 'okay';
            if (config.slideshowInterval === undefined) config.slideshowInterval = 0;
            if (config.autoPoster === undefined) config.autoPoster = true;
            if (config.autoEpisode === undefined) config.autoEpisode = true;
            if (config.autoDate === undefined) config.autoDate = true;

            delete config.imdb_id;
            delete config.mal_id;
        } else {
            config = { ...defaultConfig };
        }
        saveConfig();
    } catch (err) {
        if (EFFECTIVE_UI === 'winforms') psError(`Failed to read config.json:\n${err.message}`);
        else if (EFFECTIVE_UI === 'kdialog') kdError(`Failed to read config.json:\n${err.message}`);
        else console.error(`Failed to read config.json: ${err.message}`);
        process.exit(1);
    }
}

function saveConfig() {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
}

// ─────────────────────────────────────────────────────────────────────
// PM2
// ─────────────────────────────────────────────────────────────────────
let cachedPm2Data = null;

function getPm2Cmd() {
    const localPm2 = path.join(__dirname, 'node_modules', 'pm2', 'bin', 'pm2');
    if (fs.existsSync(localPm2)) return `node "${localPm2}"`;

    return process.platform === 'win32'
        ? 'npx --silent pm2'
        : 'npx --silent pm2';
}

function fetchPm2Data() {
    try {
        const cmd = getPm2Cmd();
        const output = execSync(`${cmd} jlist`, {
            cwd: __dirname,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        cachedPm2Data = JSON.parse(output);
    } catch (err) {
        cachedPm2Data = [];
    }
}

function getIndexStatus() {
    if (!cachedPm2Data) return 'Stopped';
    const indexProcess = cachedPm2Data.find(
        proc => proc.name === 'index' && proc.pm2_env.status === 'online'
    );
    return indexProcess ? 'Running' : 'Stopped';
}

function getPm2Table() {
    if (!cachedPm2Data || cachedPm2Data.length === 0) return '[No PM2 processes found]';

    let table = '┌───────────────┬───────────┬───────┬─────────┐\n';
    table +=    '│ name          │ status    │ cpu   │ memory  │\n';
    table +=    '├───────────────┼───────────┼───────┼─────────┤\n';

    cachedPm2Data.forEach(proc => {
        const name = proc.name.padEnd(13, ' ');
        const status = proc.pm2_env.status.padEnd(9, ' ');
        const cpu = (proc.monit.cpu + '%').padEnd(5, ' ');
        const memory = (Math.round(proc.monit.memory / 1024 / 1024 * 10) / 10 + 'mb').padEnd(7, ' ');
        table += `│ ${name} │ ${status} │ ${cpu} │ ${memory} │\n`;
    });

    table +=    '└───────────────┴───────────┴───────┴─────────┘';
    return table;
}

function runNpmCommand(command) {
    try {
        const cmd = getPm2Cmd();

        if (command === 'start') {
            execSync(`${cmd} start index.js --name index`, {
                cwd: __dirname,
                stdio: 'ignore',
                shell: true
            });
        } else if (command === 'stop') {
            execSync(`${cmd} flush`, {
                cwd: __dirname,
                stdio: 'ignore',
                shell: true
            });
            execSync(`${cmd} stop index`, {
                cwd: __dirname,
                stdio: 'ignore',
                shell: true
            });
            execSync(`${cmd} delete index`, {
                cwd: __dirname,
                stdio: 'ignore',
                shell: true
            });
        }
    } catch (err) {
        const msg = `Gagal menjalankan perintah PM2:\n${err.message}`;
        if (EFFECTIVE_UI === 'winforms') psError(msg);
        else if (EFFECTIVE_UI === 'kdialog') kdError(msg);
        else console.error(msg);
    }
}

// ─────────────────────────────────────────────────────────────────────
// LIVE LOG
// ─────────────────────────────────────────────────────────────────────
function showTuiLiveLogs() {
    return new Promise(async resolve => {
        if (process.platform === 'win32') clearScreen();

        console.log('==================================================');
        console.log('🟢 STREAMING LIVE PM2 LOG (ACTIVE)');
        console.log('==================================================');
        console.log('Press [ENTER] at any time to stop logging and return to menu.\n');

        const pm2Cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const logProcess = spawn(pm2Cmd, [
            '--silent', 'pm2', 'logs', 'index',
            '--out', '--raw', '--lines', '35'
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
            cwd: __dirname
        });

        const filterAndPrint = data => {
            const text = data.toString();

            if (text.includes('🧹 Console auto-cleared')) {
                clearScreen();
                console.log('==================================================');
                console.log('🟢 STREAMING LIVE PM2 LOG (ACTIVE - CLEARED)');
                console.log('==================================================');
                console.log('Press [ENTER] at any time to stop logging and return to menu.\n');
            }

            const filteredLines = text.split('\n').filter(line => (
                !line.includes('[TAILING]') &&
                !line.includes('last 35 lines:') &&
                !line.includes('🧹 Console auto-cleared')
            ));

            const finalOutput = filteredLines.join('\n').trim();
            if (finalOutput) process.stdout.write(finalOutput + '\n');
        };

        logProcess.stdout.on('data', filterAndPrint);
        logProcess.stderr.on('data', filterAndPrint);
        logProcess.on('error', err => console.error('\n⚠️ Failed to load log:', err.message));

        await question('');
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /pid ${logProcess.pid} /T /F`, { stdio: 'ignore' });
            } else {
                logProcess.kill();
            }
        } catch (e) {}

        resolve();
    });
}

function viewLiveLogs() {
    if (EFFECTIVE_UI === 'tui') return showTuiLiveLogs();

    const cmd = getPm2Cmd();

    if (EFFECTIVE_UI === 'winforms') {
        const tempBat = path.join(require('os').tmpdir(), 'mpc-discord-livelog.bat');
        const logCommand =
            `${cmd} logs index --out --raw --lines 35 | ` +
            `findstr /v /c:"[TAILING]" /c:"last 35 lines:"`;

        const batContent = [
            '@echo off',
            'title Live Log - MPC Discord Presence',
            'chcp 65001 >nul',
            `cd /d "${__dirname}"`,
            logCommand,
            'echo.',
            'pause',
            ''
        ].join('\r\n');

        try {
            fs.writeFileSync(tempBat, batContent, 'utf8');
            spawn(
                'cmd.exe',
                ['/c', 'start', '', tempBat],
                { detached: true, stdio: 'ignore', shell: false }
            ).unref();
        } catch (err) {
            psError(`Gagal membuka Live Log:\n${err.message}`);
        }
        return;
    }

    // Linux/KDE GUI
    const logCommand =
        `${cmd} logs index --out --raw --lines 35 | ` +
        `grep -v --line-buffered -E '\\[TAILING\\]|last 35 lines:'; ` +
        `echo; read -p "Tekan ENTER untuk menutup..."`;

    const hasKonsole = spawnSync('which', ['konsole']).status === 0;
    const hasXterm = spawnSync('which', ['xterm']).status === 0;

    if (hasKonsole) {
        spawn('konsole', ['-e', 'bash', '-c', logCommand], {
            detached: true,
            stdio: 'ignore',
            cwd: __dirname
        }).unref();
    } else if (hasXterm) {
        spawn('xterm', ['-e', 'bash', '-c', logCommand], {
            detached: true,
            stdio: 'ignore',
            cwd: __dirname
        }).unref();
    } else {
        kdError('Tidak menemukan terminal emulator (konsole/xterm) untuk menampilkan live log.');
    }
}

// ─────────────────────────────────────────────────────────────────────
// TUI helpers / screens
// ─────────────────────────────────────────────────────────────────────
function clearScreen() {
    try {
        if (process.platform === 'win32') {
            process.stdout.write('\x1Bc');
        } else {
            process.stdout.write('\x1b_Ga=d\x1b\\');
            execSync('clear', { stdio: 'inherit' });
        }
    } catch (e) {
        console.clear();
    }
}

function printFullConfig() {
    console.log('==================================================');
    console.log('            ⚙️ CURRENT CONFIG.JSON STATUS          ');
    console.log('==================================================');
    console.log(` [KEY]  Personal TMDb     : '${config.personal_tmdb_token ? 'Set (Hidden)' : 'Empty (Using Default)'}'`);
    console.log(` [TEXT] tmdb_id           : '${config.tmdb_id || ''}'`);
    console.log(` [TEXT] customText        : '${config.customText || ''}'`);
    console.log(` [TEXT] customBigText     : '${config.customBigText || ''}'`);
    console.log(` [SW]   Auto TMDb         : Poster(${config.autoPoster ? 'On' : 'Off'}) | Ep(${config.autoEpisode ? 'On' : 'Off'}) | Date(${config.autoDate ? 'On' : 'Off'})`);
    console.log(` [SW]   cleanFilename     : ${config.cleanFilename}`);
    console.log(` [SW]   romajiTitle       : ${config.romajiTitle}`);
    console.log(` [SW]   randomPoster      : ${config.randomPoster}`);
    console.log(` [SW]   Don't             : '${config.dont}'`);
    console.log(` [IMG]  slideshowInterval : ${config.slideshowInterval} seconds`);
    console.log(` [IMG]  customImage       : [${config.customImage.length} URL]`);
    console.log(` [RGX]  cleanRegex        : [${config.cleanRegex.length} rules]`);
    console.log('==================================================\n');
}

function printTextConfig() {
    console.log('==================================================');
    console.log('             ⚙️ TEXT & IDs CONFIG                ');
    console.log('==================================================');
    console.log(` [KEY]  Personal TMDb     : '${config.personal_tmdb_token ? 'Set (Hidden)' : 'Empty (Using Default)'}'`);
    console.log(` [TEXT] tmdb_id           : '${config.tmdb_id || ''}'`);
    console.log(` [TEXT] customText        : '${config.customText || ''}'`);
    console.log(` [TEXT] customBigText     : '${config.customBigText || ''}'`);
    console.log('==================================================\n');
}

function printSwitchesConfig() {
    console.log('==================================================');
    console.log('               ⚙️ SWITCHES CONFIG                ');
    console.log('==================================================');
    console.log(` [SW]   Auto TMDb         : Poster(${config.autoPoster ? 'On' : 'Off'}) | Ep(${config.autoEpisode ? 'On' : 'Off'}) | Date(${config.autoDate ? 'On' : 'Off'})`);
    console.log(` [SW]   cleanFilename     : ${config.cleanFilename}`);
    console.log(` [SW]   romajiTitle       : ${config.romajiTitle}`);
    console.log(` [SW]   randomPoster      : ${config.randomPoster}`);
    console.log(` [SW]   Don't             : '${config.dont}'`);
    console.log('==================================================\n');
}

function printImageConfig() {
    console.log('==================================================');
    console.log('          ⚙️ CUSTOM IMAGE & SLIDESHOW            ');
    console.log('==================================================');
    console.log(` [IMG]  slideshowInterval : ${config.slideshowInterval} seconds`);
    console.log(` [IMG]  customImage       : [${config.customImage.length} URL]`);
    console.log('==================================================\n');
}

// ─────────────────────────────────────────────────────────────────────
// TUI menus — original readline behavior preserved
// ─────────────────────────────────────────────────────────────────────
function mainMenuTui() {
    clearScreen();
    fetchPm2Data();

    const status = getIndexStatus();
    const isRunning = status === 'Running';

    console.log('=== MPC Discord Presence Menu ===\n');
    printFullConfig();

    console.log(`📌 index.js status: ${isRunning ? 'Running 🟢' : 'Stopped 🔴'}`);
    console.log(getPm2Table());
    console.log('');

    console.log('--- 🏠 MAIN MENU ---');
    console.log(`1. ${isRunning ? '⏹️ Stop index.js (PM2)' : '🎬 Start index.js (PM2)'}`);
    console.log('2. 📜 View Live Log (PM2)');
    console.log('3. 📝 Edit Text & IDs');
    console.log('4. 🕹️ Edit Switches (True/False)');
    console.log('5. 🖼️ Edit Custom Image & Slideshow');
    console.log('6. 🧹 Edit Clean Regex');
    console.log('0. ❌ Exit');

    rl.question('\nChoose an option: ', choice => handleMainMenuTui(choice, isRunning));
}

function handleMainMenuTui(choice, isRunning) {
    switch (choice.trim()) {
        case '1':
            if (isRunning) {
                console.log('Stopping index.js...');
                runNpmCommand('stop');
            } else {
                console.log('Starting index.js...');
                runNpmCommand('start');
            }
            setTimeout(mainMenuTui, 1500);
            break;

        case '2':
            viewLiveLogs().then(mainMenuTui);
            break;

        case '3':
            textMenuTui();
            break;

        case '4':
            switchesMenuTui();
            break;

        case '5':
            imageMenuTui();
            break;

        case '6':
            editArrayMenuTui('cleanRegex', 'Regex patterns for cleaning filenames', mainMenuTui);
            break;

        case '0':
            rl.close();
            break;

        default:
            mainMenuTui();
            break;
    }
}

function textMenuTui() {
    clearScreen();
    printTextConfig();
    console.log('--- 📝 TEXT & IDs MENU ---');
    console.log('1. Edit personal_tmdb_token (Personal API Key)');
    console.log('2. Edit tmdb_id');
    console.log('3. Edit customText');
    console.log('4. Edit customBigText');
    console.log('0. 🔙 Back');

    rl.question('\nChoose an option: ', choice => {
        switch (choice.trim()) {
            case '1': editStringTui('personal_tmdb_token', 'Enter Personal TMDb Token (JWT/Bearer)', textMenuTui); break;
            case '2': editStringTui('tmdb_id', 'Enter tmdb_id', textMenuTui); break;
            case '3': editStringTui('customText', 'Enter customText', textMenuTui); break;
            case '4': editStringTui('customBigText', 'Enter customBigText', textMenuTui); break;
            case '0': mainMenuTui(); break;
            default: textMenuTui(); break;
        }
    });
}

function switchesMenuTui() {
    clearScreen();
    printSwitchesConfig();
    console.log('--- 🕹️ SWITCHES MENU ---');
    console.log('1. Auto TMDb Menu 📽');
    console.log(`2. Toggle cleanFilename (${config.cleanFilename})`);
    console.log(`3. Toggle romajiTitle   (${config.romajiTitle})`);
    console.log(`4. Toggle randomPoster  (${config.randomPoster})`);
    console.log(`5. Don't                (${config.dont})`);
    console.log('0. 🔙 Back');

    rl.question('\nChoose an option: ', choice => {
        switch (choice.trim()) {
            case '1': autoTmdbMenuTui(); break;
            case '2': config.cleanFilename = !config.cleanFilename; saveConfig(); switchesMenuTui(); break;
            case '3': config.romajiTitle = !config.romajiTitle; saveConfig(); switchesMenuTui(); break;
            case '4': config.randomPoster = !config.randomPoster; saveConfig(); switchesMenuTui(); break;
            case '5': config.dont = config.dont === 'okay' ? 'nah' : 'okay'; saveConfig(); switchesMenuTui(); break;
            case '0': mainMenuTui(); break;
            default: switchesMenuTui(); break;
        }
    });
}

function autoTmdbMenuTui() {
    clearScreen();
    console.log('==================================================');
    console.log('               📽  AUTO TMDb CONFIG               ');
    console.log('==================================================');
    console.log(` [SW] autoPoster  : ${config.autoPoster}`);
    console.log(` [SW] autoEpisode : ${config.autoEpisode}`);
    console.log(` [SW] autoDate    : ${config.autoDate}`);
    console.log('==================================================\n');
    console.log('--- 📽  AUTO TMDb MENU ---');
    console.log(`1. Toggle autoPoster  (${config.autoPoster})`);
    console.log(`2. Toggle autoEpisode (${config.autoEpisode})`);
    console.log(`3. Toggle autoDate    (${config.autoDate})`);
    console.log('4. Let it Ride');
    console.log('0. 🔙 Back');

    rl.question('\nChoose an option: ', choice => {
        switch (choice.trim()) {
            case '1': config.autoPoster = !config.autoPoster; saveConfig(); autoTmdbMenuTui(); break;
            case '2': config.autoEpisode = !config.autoEpisode; saveConfig(); autoTmdbMenuTui(); break;
            case '3': config.autoDate = !config.autoDate; saveConfig(); autoTmdbMenuTui(); break;
            case '4':
                config.autoPoster = true;
                config.autoEpisode = true;
                config.autoDate = true;
                saveConfig();
                switchesMenuTui();
                break;
            case '0': switchesMenuTui(); break;
            default: autoTmdbMenuTui(); break;
        }
    });
}

function imageMenuTui() {
    clearScreen();
    printImageConfig();
    console.log('--- 🖼️ CUSTOM IMAGE & SLIDESHOW MENU ---');
    console.log('1. Edit customImage URL Array');
    console.log('2. Set slideshowInterval (Seconds)');
    console.log('0. 🔙 Back');

    rl.question('\nChoose an option: ', choice => {
        switch (choice.trim()) {
            case '1': editArrayMenuTui('customImage', 'Custom Image URLs', imageMenuTui); break;
            case '2':
                rl.question('Interval in seconds (0 to disable slideshow): ', val => {
                    if (!isNaN(parseInt(val, 10))) {
                        config.slideshowInterval = parseInt(val, 10);
                        saveConfig();
                    }
                    imageMenuTui();
                });
                break;
            case '0': mainMenuTui(); break;
            default: imageMenuTui(); break;
        }
    });
}

function editStringTui(key, promptText, callback) {
    rl.question(`${promptText} (Type then Enter, leave blank to clear): `, val => {
        config[key] = val.trim();
        saveConfig();
        callback();
    });
}

function editArrayMenuTui(key, description, callback) {
    clearScreen();
    console.log(`--- 🗃️ EDIT ARRAY: ${key} ---`);
    console.log(`Info: ${description}`);
    config[key].forEach((item, index) => console.log(`[${index + 1}]. ${item}`));
    console.log('-------------------');
    console.log('A. Add new entry');

    const canDelete = config[key].length > 1;
    if (canDelete) console.log('D. Delete entry (by number)');

    console.log('R. Reset to default');
    console.log('0. 🔙 Back');

    rl.question('\nChoose an action: ', action => {
        action = action.trim().toUpperCase();

        if (action === 'A') {
            rl.question('Enter new text/URL: ', val => {
                config[key].push(val.trim());
                saveConfig();
                editArrayMenuTui(key, description, callback);
            });
        } else if (action === 'D') {
            if (!canDelete) return editArrayMenuTui(key, description, callback);

            rl.question('Enter the entry number to delete: ', val => {
                const idx = parseInt(val, 10) - 1;
                if (idx >= 0 && idx < config[key].length) {
                    config[key].splice(idx, 1);
                    saveConfig();
                }
                editArrayMenuTui(key, description, callback);
            });
        } else if (action === 'R') {
            config[key] = key === 'cleanRegex'
                ? [...defaultConfig.cleanRegex]
                : [''];
            saveConfig();
            editArrayMenuTui(key, description, callback);
        } else if (action === '0') {
            callback();
        } else {
            editArrayMenuTui(key, description, callback);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────
// GUI menus — WinForms / KDialog
// ─────────────────────────────────────────────────────────────────────
function guiMessageBox(text) {
    if (EFFECTIVE_UI === 'winforms') psMsgBox(text);
    else kdMsgBox(text);
}

function guiError(text) {
    if (EFFECTIVE_UI === 'winforms') psError(text);
    else kdError(text);
}

function guiYesNo(text) {
    return EFFECTIVE_UI === 'winforms' ? psYesNo(text) : kdYesNo(text);
}

function guiInputBox(promptText, currentValue) {
    return EFFECTIVE_UI === 'winforms'
        ? psInputBox(promptText, currentValue)
        : kdInputBox(promptText, currentValue);
}

function guiMenu(promptText, items) {
    return EFFECTIVE_UI === 'winforms'
        ? psMenu(promptText, items)
        : kdMenu(promptText, items);
}

function guiCheckList(promptText, items) {
    return EFFECTIVE_UI === 'winforms'
        ? psCheckList(promptText, items)
        : kdCheckList(promptText, items);
}

function mainMenuGui() {
    while (true) {
        fetchPm2Data();

        const isRunning = getIndexStatus() === 'Running';
        const promptText = mono(
            `📌 index.js status: ${isRunning ? 'Running' : 'Stopped'}\n\n` +
            buildFullConfigText() +
            '\n\nPilih menu:'
        );

        const choice = guiMenu(promptText, [
            ['toggle_run', isRunning ? '⏹️ Stop index.js (PM2)' : '▶️ Start index.js (PM2)'],
            ['log', '📜 Buka Live Log (terminal terpisah)'],
            ['text', '📝 Edit Text & IDs'],
            ['switches', '🕹️ Edit Switches (True/False)'],
            ['image', '🖼️ Edit Custom Image & Slideshow'],
            ['regex', '🧹 Edit Clean Regex'],
            ['exit', '❌ Exit']
        ]);

        if (choice === null || choice === 'exit') return;

        switch (choice) {
            case 'toggle_run':
                runNpmCommand(isRunning ? 'stop' : 'start');
                break;
            case 'log':
                viewLiveLogs();
                break;
            case 'text':
                textMenuGui();
                break;
            case 'switches':
                switchesMenuGui();
                break;
            case 'image':
                imageMenuGui();
                break;
            case 'regex':
                editArrayMenuGui('cleanRegex', 'Regex patterns untuk membersihkan filename');
                break;
        }
    }
}

function textMenuGui() {
    while (true) {
        const choice = guiMenu('--- TEXT & IDs MENU ---', [
            ['token', `Edit personal_tmdb_token  ('${config.personal_tmdb_token ? 'Set (Hidden)' : ''}')`],
            ['tmdb_id', `Edit tmdb_id  ('${config.tmdb_id || ''}')`],
            ['customText', `Edit customText  ('${config.customText || ''}')`],
            ['customBigText', `Edit customBigText  ('${config.customBigText || ''}')`],
            ['back', '🔙 Back']
        ]);

        if (choice === null || choice === 'back') return;

        const fieldMap = {
            token: ['personal_tmdb_token', 'Enter Personal TMDb Token (JWT/Bearer)'],
            tmdb_id: ['tmdb_id', 'Enter tmdb_id'],
            customText: ['customText', 'Enter customText'],
            customBigText: ['customBigText', 'Enter customBigText']
        };

        const [key, label] = fieldMap[choice];
        const val = guiInputBox(label, config[key]);
        if (val !== null) {
            config[key] = val.trim();
            saveConfig();
        }
    }
}

function switchesMenuGui() {
    while (true) {
        const choice = guiMenu('--- SWITCHES MENU ---', [
            ['autotmdb', '📽 Auto TMDb Menu (Poster/Episode/Date)'],
            ['toggles', '🕹️ Toggle cleanFilename / romajiTitle / randomPoster'],
            ['dont', `Toggle Don't  (saat ini: '${config.dont}')`],
            ['back', '🔙 Back']
        ]);

        if (choice === null || choice === 'back') return;

        if (choice === 'autotmdb') {
            autoTmdbMenuGui();
        } else if (choice === 'toggles') {
            const selected = guiCheckList(
                'Centang untuk AKTIF, kosongkan untuk NONAKTIF:',
                [
                    ['cleanFilename', 'cleanFilename', config.cleanFilename],
                    ['romajiTitle', 'romajiTitle', config.romajiTitle],
                    ['randomPoster', 'randomPoster', config.randomPoster]
                ]
            );

            if (selected !== null) {
                config.cleanFilename = selected.includes('cleanFilename');
                config.romajiTitle = selected.includes('romajiTitle');
                config.randomPoster = selected.includes('randomPoster');
                saveConfig();
            }
        } else if (choice === 'dont') {
            config.dont = config.dont === 'okay' ? 'nah' : 'okay';
            saveConfig();
        }
    }
}

function autoTmdbMenuGui() {
    while (true) {
        const promptText = mono(
            [
                line('autoPoster', config.autoPoster),
                line('autoEpisode', config.autoEpisode),
                line('autoDate', config.autoDate)
            ].join('\n') + '\n\nPilih menu:'
        );

        const choice = guiMenu(promptText, [
            ['toggles', '🕹️ Toggle autoPoster / autoEpisode / autoDate'],
            ['letitride', '🚀 Let it Ride (aktifkan semua)'],
            ['back', '🔙 Back']
        ]);

        if (choice === null || choice === 'back') return;

        if (choice === 'toggles') {
            const selected = guiCheckList(
                'Centang untuk AKTIF, kosongkan untuk NONAKTIF:',
                [
                    ['autoPoster', 'autoPoster', config.autoPoster],
                    ['autoEpisode', 'autoEpisode', config.autoEpisode],
                    ['autoDate', 'autoDate', config.autoDate]
                ]
            );

            if (selected !== null) {
                config.autoPoster = selected.includes('autoPoster');
                config.autoEpisode = selected.includes('autoEpisode');
                config.autoDate = selected.includes('autoDate');
                saveConfig();
            }
        } else if (choice === 'letitride') {
            config.autoPoster = true;
            config.autoEpisode = true;
            config.autoDate = true;
            saveConfig();
            return;
        }
    }
}

function imageMenuGui() {
    while (true) {
        const promptText = mono(
            [
                line('customImage', `[${config.customImage.length} URL]`),
                line('slideshowInterval', `${config.slideshowInterval} seconds`)
            ].join('\n') + '\n\nPilih menu:'
        );

        const choice = guiMenu(promptText, [
            ['edit', '🖼️ Edit customImage URL Array'],
            ['interval', '⏱️ Set slideshowInterval (Seconds)'],
            ['back', '🔙 Back']
        ]);

        if (choice === null || choice === 'back') return;

        if (choice === 'edit') {
            editArrayMenuGui('customImage', 'Custom Image URLs');
        } else if (choice === 'interval') {
            const val = guiInputBox(
                'Interval dalam detik (0 untuk menonaktifkan slideshow):',
                String(config.slideshowInterval)
            );

            if (val !== null && !isNaN(parseInt(val, 10))) {
                config.slideshowInterval = parseInt(val, 10);
                saveConfig();
            }
        }
    }
}

function editArrayMenuGui(key, description) {
    while (true) {
        const indexWidth = String(config[key].length).length;
        const listText = config[key]
            .map((item, i) => `[${String(i + 1).padStart(indexWidth, ' ')}] ${item}`)
            .join('\n') || '(kosong)';

        const promptText = mono(`${description}\n\n${listText}\n\nPilih aksi:`);

        const menuItems = [['add', '➕ Add new entry']];
        if (config[key].length > 1) menuItems.push(['delete', '🗑️ Delete entry']);
        menuItems.push(['reset', '♻️ Reset to default']);
        menuItems.push(['back', '🔙 Back']);

        const choice = guiMenu(promptText, menuItems);

        if (choice === null || choice === 'back') return;

        if (choice === 'add') {
            const val = guiInputBox('Enter new text/URL:', '');
            if (val !== null && val.trim() !== '') {
                config[key].push(val.trim());
                saveConfig();
            }
        } else if (choice === 'delete') {
            const delItems = config[key].map((item, i) => [String(i), `[${i + 1}] ${item}`]);
            const delChoice = guiMenu('Pilih entry yang mau dihapus:', delItems);

            if (delChoice !== null) {
                const idx = parseInt(delChoice, 10);
                if (idx >= 0 && idx < config[key].length) {
                    config[key].splice(idx, 1);
                    saveConfig();
                }
            }
        } else if (choice === 'reset') {
            if (guiYesNo(`Yakin reset "${key}" ke nilai default?`)) {
                config[key] = key === 'cleanRegex'
                    ? [...defaultConfig.cleanRegex]
                    : [''];
                saveConfig();
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────
function main() {
    if (EFFECTIVE_UI === 'winforms') ensurePowerShell();
    if (EFFECTIVE_UI === 'kdialog') ensureKdialog();

    loadConfig();

    if (EFFECTIVE_UI === 'tui') {
        mainMenuTui();
    } else {
        mainMenuGui();
    }
}

main();
