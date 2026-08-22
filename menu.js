const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const configPath = path.join(__dirname, 'config.json');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

let config = {};

// DIPERBAIKI: mal_id dihapus dari defaultConfig (Jikan/MAL sudah tidak dipakai)
const defaultConfig = {
    personal_tmdb_token: "", tmdb_id: "", customText: "", customBigText: "",
    autoPoster: true, autoEpisode: true, autoDate: true,
    cleanFilename: true, romajiTitle: false, randomPoster: false,
    dont: "okay", slideshowInterval: 0, customImage: [""],
    cleanRegex: ["\\b(2160p|1080p|720p|480p)\\b", "\\b(BluRay|BRRip|BDRip|WEBRip|WEB-DL|WEB-HD|WEBDL|HDRip|HDTV|DVDRip|CAM|TS|TC)\\b", "\\b(x264|x265|H264|H265|HEVC|AAC|AC3|EAC3|DTS|FLAC|10bit|8bit)\\b", "\\b\\d{2,4}MB\\b", "\\b\\d{1,2}\\.\\d{1,2}GB\\b", "-?Pahe\\.in", "-?PSA", "-?YTS\\.[A-Z]{2}"]
};

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.personal_tmdb_token === undefined) config.personal_tmdb_token = "";
            if (config.tmdb_id === undefined) config.tmdb_id = config.imdb_id || "";
            if (config.romajiTitle === undefined) config.romajiTitle = false;
            if (config.randomPoster === undefined) config.randomPoster = true;
            if (config.dont === undefined) config.dont = "okay";
            if (config.slideshowInterval === undefined) config.slideshowInterval = 0;
            if (config.autoPoster === undefined) config.autoPoster = true;
            if (config.autoEpisode === undefined) config.autoEpisode = true;
            if (config.autoDate === undefined) config.autoDate = true;
            delete config.imdb_id;
            delete config.mal_id; // DIPERBAIKI: bersihkan mal_id lama kalau masih ada di config.json existing
        } else {
            config = { ...defaultConfig };
        }
        saveConfig();
    } catch (err) { console.error("Failed to read config.json", err); }
}

function saveConfig() { fs.writeFileSync(configPath, JSON.stringify(config, null, 4)); }

function clearScreen() {
    try {
        if (process.platform === 'win32') {
            process.stdout.write('\x1Bc');
        } else {
            process.stdout.write('\x1b_Ga=d\x1b\\');
            execSync('clear', { stdio: 'inherit' });
        }
    } catch (e) { console.clear(); }
}

// ==========================================
// BLOK PM2
// ==========================================
let cachedPm2Data = null;

// Jalur Pintas: Lewati 'npx' agar loading di Windows jadi secepat kilat (Instan)
function getPm2Cmd() {
    const localPm2 = path.join(__dirname, 'node_modules', 'pm2', 'bin', 'pm2');
    if (fs.existsSync(localPm2)) return `node "${localPm2}"`;
    return 'npx --silent pm2';
}

function fetchPm2Data() {
    try {
        const cmd = getPm2Cmd();
        const output = execSync(`${cmd} jlist`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        cachedPm2Data = JSON.parse(output);
    } catch (err) {
        cachedPm2Data = [];
    }
}

function getIndexStatus() {
    if (!cachedPm2Data) return 'Stopped';
    const indexProcess = cachedPm2Data.find(proc => proc.name === 'index' && proc.pm2_env.status === 'online');
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
            execSync(`cd "${__dirname}" && ${cmd} start index.js --name index`, { stdio: 'ignore' });
        } else if (command === 'stop') {
            execSync(`cd "${__dirname}" && ${cmd} flush`, { stdio: 'ignore' });
            execSync(`cd "${__dirname}" && ${cmd} stop index`, { stdio: 'ignore' });
            execSync(`cd "${__dirname}" && ${cmd} delete index`, { stdio: 'ignore' });
        }
    } catch (err) {}
}

// ==========================================
// BLOK TAMPILAN CONFIG TERPISAH
// ==========================================
function printFullConfig() {
    console.log("==================================================");
    console.log("            ⚙️ CURRENT CONFIG.JSON STATUS          ");
    console.log("==================================================");
    console.log(` [KEY]  Personal TMDb     : '${config.personal_tmdb_token ? "Set (Hidden)" : "Empty (Using Default)"}'`);
    console.log(` [TEXT] tmdb_id           : '${config.tmdb_id || ""}'`);
    console.log(` [TEXT] customText        : '${config.customText || ""}'`);
    console.log(` [TEXT] customBigText     : '${config.customBigText || ""}'`);
    console.log(` [SW]   Auto TMDb         : Poster(${config.autoPoster ? 'On' : 'Off'}) | Ep(${config.autoEpisode ? 'On' : 'Off'}) | Date(${config.autoDate ? 'On' : 'Off'})`);
    console.log(` [SW]   cleanFilename     : ${config.cleanFilename}`);
    console.log(` [SW]   romajiTitle       : ${config.romajiTitle}`);
    console.log(` [SW]   randomPoster      : ${config.randomPoster}`);
    console.log(` [SW]   Don't             : '${config.dont}'`);
    console.log(` [IMG]  slideshowInterval : ${config.slideshowInterval} seconds`);
    console.log(` [IMG]  customImage       : [${config.customImage.length} URL]`);
    console.log(` [RGX]  cleanRegex        : [${config.cleanRegex.length} rules]`);
    console.log("==================================================\n");
}

function printTextConfig() {
    console.log("==================================================");
    console.log("             ⚙️ TEXT & IDs CONFIG                ");
    console.log("==================================================");
    console.log(` [KEY]  Personal TMDb     : '${config.personal_tmdb_token ? "Set (Hidden)" : "Empty (Using Default)"}'`);
    console.log(` [TEXT] tmdb_id           : '${config.tmdb_id || ""}'`);
    console.log(` [TEXT] customText        : '${config.customText || ""}'`);
    console.log(` [TEXT] customBigText     : '${config.customBigText || ""}'`);
    console.log("==================================================\n");
}

function printSwitchesConfig() {
    console.log("==================================================");
    console.log("               ⚙️ SWITCHES CONFIG                ");
    console.log("==================================================");
    console.log(` [SW]   Auto TMDb         : Poster(${config.autoPoster ? 'On' : 'Off'}) | Ep(${config.autoEpisode ? 'On' : 'Off'}) | Date(${config.autoDate ? 'On' : 'Off'})`);
    console.log(` [SW]   cleanFilename     : ${config.cleanFilename}`);
    console.log(` [SW]   romajiTitle       : ${config.romajiTitle}`);
    console.log(` [SW]   randomPoster      : ${config.randomPoster}`);
    console.log(` [SW]   Don't             : '${config.dont}'`);
    console.log("==================================================\n");
}

function printImageConfig() {
    console.log("==================================================");
    console.log("          ⚙️ CUSTOM IMAGE & SLIDESHOW            ");
    console.log("==================================================");
    console.log(` [IMG]  slideshowInterval : ${config.slideshowInterval} seconds`);
    console.log(` [IMG]  customImage       : [${config.customImage.length} URL]`);
    console.log("==================================================\n");
}

// ==========================================
// MENU NAVIGASI
// ==========================================
function mainMenu() {
    clearScreen();
    fetchPm2Data();
    const status = getIndexStatus();
    const isRunning = status === 'Running';

    console.log("=== MPC Discord Presence Menu ===\n");
    printFullConfig();

    console.log(`📌 index.js status: ${isRunning ? 'Running 🟢' : 'Stopped 🔴'}`);
    console.log(getPm2Table());
    console.log("");

    console.log("--- 🏠 MAIN MENU ---");
    console.log(`1. ${isRunning ? '⏹️ Stop index.js (PM2)' : '🎬 Start index.js (PM2)'}`);
    console.log("2. 📜 View Live Log (PM2)");
    console.log("3. 📝 Edit Text & IDs");
    console.log("4. 🕹️ Edit Switches (True/False)");
    console.log("5. 🖼️ Edit Custom Image & Slideshow");
    console.log("6. 🧹 Edit Clean Regex");
    console.log("0. ❌ Exit");
    rl.question("\nChoose an option: ", (choice) => handleMainMenu(choice, isRunning));
}

function handleMainMenu(choice, isRunning) {
    switch (choice.trim()) {
        case '1':
            if (isRunning) {
                console.log("Stopping index.js...");
                runNpmCommand('stop');
            } else {
                console.log("Starting index.js...");
                runNpmCommand('start');
            }
            setTimeout(mainMenu, 1500); break;
        case '2': viewLiveLogs(); break;
        case '3': textMenu(); break;
        case '4': switchesMenu(); break;
        case '5': imageMenu(); break;
        case '6': editArrayMenu('cleanRegex', "Regex patterns for cleaning filenames", mainMenu); break;
        case '0': rl.close(); break;
        default: mainMenu(); break;
    }
}

// DIPERBAIKI: opsi mal_id dihapus, menu Text & IDs sekarang tinggal 4 item (personal_tmdb_token, tmdb_id, customText, customBigText)
function textMenu() {
    clearScreen();
    printTextConfig();
    console.log("--- 📝 TEXT & IDs MENU ---");
    console.log("1. Edit personal_tmdb_token (Personal API Key)");
    console.log("2. Edit tmdb_id");
    console.log("3. Edit customText");
    console.log("4. Edit customBigText");
    console.log("0. 🔙 Back");
    rl.question("\nChoose an option: ", (choice) => {
        switch (choice.trim()) {
            case '1': editString('personal_tmdb_token', "Enter Personal TMDb Token (JWT/Bearer)", textMenu); break;
            case '2': editString('tmdb_id', "Enter tmdb_id", textMenu); break;
            case '3': editString('customText', "Enter customText", textMenu); break;
            case '4': editString('customBigText', "Enter customBigText", textMenu); break;
            case '0': mainMenu(); break;
            default: textMenu(); break;
        }
    });
}

function switchesMenu() {
    clearScreen();
    printSwitchesConfig();
    console.log("--- 🕹️ SWITCHES MENU ---");
    console.log("1. Auto TMDb Menu 📽");
    console.log(`2. Toggle cleanFilename (${config.cleanFilename})`);
    console.log(`3. Toggle romajiTitle   (${config.romajiTitle})`);
    console.log(`4. Toggle randomPoster  (${config.randomPoster})`);
    console.log(`5. Don't                (${config.dont})`);
    console.log("0. 🔙 Back");
    rl.question("\nChoose an option: ", (choice) => {
        switch (choice.trim()) {
            case '1': autoTmdbMenu(); break;
            case '2': config.cleanFilename = !config.cleanFilename; saveConfig(); switchesMenu(); break;
            case '3': config.romajiTitle = !config.romajiTitle; saveConfig(); switchesMenu(); break;
            case '4': config.randomPoster = !config.randomPoster; saveConfig(); switchesMenu(); break;
            case '5': config.dont = config.dont === 'okay' ? 'nah' : 'okay'; saveConfig(); switchesMenu(); break;
            case '0': mainMenu(); break;
            default: switchesMenu(); break;
        }
    });
}

function autoTmdbMenu() {
    clearScreen();
    console.log("==================================================");
    console.log("               📽  AUTO TMDb CONFIG               ");
    console.log("==================================================");
    console.log(` [SW] autoPoster  : ${config.autoPoster}`);
    console.log(` [SW] autoEpisode : ${config.autoEpisode}`);
    console.log(` [SW] autoDate    : ${config.autoDate}`);
    console.log("==================================================\n");
    console.log("--- 📽  AUTO TMDb MENU ---");
    console.log(`1. Toggle autoPoster  (${config.autoPoster})`);
    console.log(`2. Toggle autoEpisode (${config.autoEpisode})`);
    console.log(`3. Toggle autoDate    (${config.autoDate})`);
    console.log("4. Let it Ride");
    console.log("0. 🔙 Back");
    rl.question("\nChoose an option: ", (choice) => {
        switch (choice.trim()) {
            case '1': config.autoPoster = !config.autoPoster; saveConfig(); autoTmdbMenu(); break;
            case '2': config.autoEpisode = !config.autoEpisode; saveConfig(); autoTmdbMenu(); break;
            case '3': config.autoDate = !config.autoDate; saveConfig(); autoTmdbMenu(); break;
            case '4':
                config.autoPoster = true;
                config.autoEpisode = true;
                config.autoDate = true;
                saveConfig();
                switchesMenu();
                break;
            case '0': switchesMenu(); break;
            default: autoTmdbMenu(); break;
        }
    });
}

function imageMenu() {
    clearScreen();
    printImageConfig();
    console.log("--- 🖼️ CUSTOM IMAGE & SLIDESHOW MENU ---");
    console.log("1. Edit customImage URL Array");
    console.log("2. Set slideshowInterval (Seconds)");
    console.log("0. 🔙 Back");
    rl.question("\nChoose an option: ", (choice) => {
        switch (choice.trim()) {
            case '1': editArrayMenu('customImage', "Custom Image URLs", imageMenu); break;
            case '2':
                rl.question("Interval in seconds (0 to disable slideshow): ", (val) => {
                    if (!isNaN(parseInt(val, 10))) { config.slideshowInterval = parseInt(val, 10); saveConfig(); }
                    imageMenu();
                }); break;
            case '0': mainMenu(); break;
            default: imageMenu(); break;
        }
    });
}

function editString(key, promptText, callback) {
    rl.question(`${promptText} (Type then Enter, leave blank to clear): `, (val) => {
        config[key] = val.trim(); saveConfig(); callback();
    });
}

function editArrayMenu(key, description, callback) {
    clearScreen();
    console.log(`--- 🗃️ EDIT ARRAY: ${key} ---`);
    console.log(`Info: ${description}`);
    config[key].forEach((item, index) => { console.log(`[${index + 1}]. ${item}`); });
    console.log("-------------------");
    console.log("A. Add new entry");

    const canDelete = config[key].length > 1;
    if (canDelete) console.log("D. Delete entry (by number)");

    console.log("R. Reset to default");
    console.log("0. 🔙 Back");

    rl.question("\nChoose an action: ", (action) => {
        action = action.trim().toUpperCase();
        if (action === 'A') {
            rl.question("Enter new text/URL: ", (val) => {
                config[key].push(val.trim()); saveConfig(); editArrayMenu(key, description, callback);
            });
        } else if (action === 'D') {
            if (!canDelete) return editArrayMenu(key, description, callback);
            rl.question("Enter the entry number to delete: ", (val) => {
                const idx = parseInt(val, 10) - 1;
                if (idx >= 0 && idx < config[key].length) { config[key].splice(idx, 1); saveConfig(); }
                editArrayMenu(key, description, callback);
            });
        } else if (action === 'R') {
            config[key] = key === 'cleanRegex' ? [...defaultConfig.cleanRegex] : [""];
            saveConfig(); editArrayMenu(key, description, callback);
        } else if (action === '0') {
            callback();
        } else {
            editArrayMenu(key, description, callback);
        }
    });
}

async function viewLiveLogs() {
    clearScreen();
    console.log('==================================================');
    console.log('🟢 STREAMING LIVE PM2 LOG (ACTIVE)');
    console.log('==================================================');
    console.log('Press [ENTER] at any time to stop logging and return to menu.\n');

    const pm2Cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const logProcess = spawn(pm2Cmd, ['--silent', 'pm2', 'logs', 'index', '--out', '--raw', '--lines', '35'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
    });

    const filterAndPrint = (data) => {
        const text = data.toString();

        if (text.includes('🧹 Console auto-cleared')) {
            clearScreen();
            console.log('==================================================');
            console.log('🟢 STREAMING LIVE PM2 LOG (ACTIVE - CLEARED)');
            console.log('==================================================');
            console.log('Press [ENTER] at any time to stop logging and return to menu.\n');
        }

        const filteredLines = text.split('\n').filter(line => {
            return !line.includes('[TAILING]') &&
            !line.includes('last 35 lines:') &&
            !line.includes('🧹 Console auto-cleared');
        });

        const finalOutput = filteredLines.join('\n').trim();
        if (finalOutput) {
            process.stdout.write(finalOutput + '\n');
        }
    };

    logProcess.stdout.on('data', filterAndPrint);
    logProcess.stderr.on('data', filterAndPrint);

    logProcess.on('error', (err) => {
        console.error('\n⚠️ Failed to load log:', err.message);
    });

    await question('');
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /pid ${logProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
            logProcess.kill();
        }
    } catch (e) {}
    mainMenu();
}

loadConfig();
mainMenu();
