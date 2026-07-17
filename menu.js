const fs = require('fs');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const path = require('path');

const configFile = path.join(__dirname, 'config.json');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Fungsi untuk menerima input dari console (promisify)
const question = (query) => new Promise(resolve => rl.question(query, resolve));

// Fungsi untuk membersihkan layar console
function clearConsole() {
    process.stdout.write('\x1Bc');
}

// Kamus penjelasan untuk setiap konfigurasi yang akan ditampilkan di menu
const configDescriptions = {
    'imdb_id': 'IMDb ID fallback for fetching poster and show title.',
    'mal_id': 'MyAnimeList ID fallback for fetching poster and show title.',
    'customText': 'Replace video title with custom text in Discord presence.',
    'customBigText': 'Replace large image text in Discord presence.',
    'autoPoster': 'Fetch poster by filename if true (may be inaccurate).',
    'cleanFilename': 'Clean video filename using regex patterns if true.',
    'customImage': 'Replace MPC logo with custom image URLs (rotates every minute).',
    'cleanRegex': 'Custom regex patterns to clean video filename.'
};

// Membaca isi config.json untuk ditampilkan di layar utama
function readConfig() {
    if (!fs.existsSync(configFile)) return 'Current config: Not found!\n';
    try {
        const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        let result = 'Current config.json:\n';
        for (const [key, value] of Object.entries(data)) {
            if (Array.isArray(value)) {
                // Menghindari tampilan kosong saat hanya tersisa 1 elemen string kosong
                if (value.length === 0 || (value.length === 1 && value[0] === "")) {
                    result += `    ${key}: ['']\n`;
                } else {
                    result += `    ${key}: [${value.map(v => `'${v}'`).join(', ')}]\n`;
                }
            } else {
                result += `    ${key}: ${value === '' ? "''" : value}\n`;
            }
        }
        return result;
    } catch (e) {
        return 'Error parsing config.json\n';
    }
}

// Mengecek status index.js yang berjalan di PM2
function getIndexStatus() {
    try {
        const output = execSync('npx --silent pm2 jlist', { encoding: 'utf-8' });
        const processes = JSON.parse(output);
        const indexProcess = processes.find(proc => proc.name === 'index' && proc.pm2_env.status === 'online');
        return indexProcess ? 'Running' : 'Stopped';
    } catch (err) {
        return 'Stopped';
    }
}

// Mendapatkan tabel ringkas status PM2
function getPm2Table() {
    try {
        const output = execSync('npx --silent pm2 jlist', { encoding: 'utf-8' });
        const processes = JSON.parse(output);
        if (processes.length === 0) return '[No PM2 processes found]';

        let table = '┌───────────────┬───────────┬───────┬─────────┐\n';
        table += '│ name          │ status    │ cpu   │ memory  │\n';
        table += '├───────────────┼───────────┼───────┼─────────┤\n';
        processes.forEach(proc => {
            const name = proc.name.padEnd(13, ' ');
            const status = proc.pm2_env.status.padEnd(9, ' ');
            const cpu = (proc.monit.cpu + '%').padEnd(5, ' ');
            const memory = (Math.round(proc.monit.memory / 1024 / 1024 * 10) / 10 + 'mb').padEnd(7, ' ');
            table += `│ ${name} │ ${status} │ ${cpu} │ ${memory} │\n`;
        });
        table += '└───────────────┴───────────┴───────┴─────────┘';
        return table;
    } catch (err) {
        return '[PM2 not running or no processes]';
    }
}

// Mengeksekusi perintah start/stop PM2 secara rahasia (silent)
function runNpmCommand(command) {
    try {
        if (command === 'start') {
            execSync(`cd "${__dirname}" && npx --silent pm2 start index.js --name index`, { stdio: 'inherit' });
        } else if (command === 'stop') {
            execSync(`cd "${__dirname}" && npx --silent pm2 stop index`, { stdio: 'inherit' });
            execSync(`cd "${__dirname}" && npx --silent pm2 delete index`, { stdio: 'inherit' });
        }
    } catch (err) {
        console.log(`Failed to run pm2 ${command}`);
    }
}

// Fitur untuk melihat log PM2 secara live
async function viewLiveLogs() {
    clearConsole();
    console.log('==================================================');
    console.log('🟢 STREAMING LIVE LOG PM2 (ACTIVE)');
    console.log('==================================================');
    console.log('Press [ENTER] at any time to stop logging and return to menu.\n');

    // Menyesuaikan command npx untuk Windows vs Linux
    const pm2Cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const logProcess = spawn(pm2Cmd, ['--silent', 'pm2', 'logs', 'index', '--raw', '--lines', '35'], {
        stdio: ['ignore', 'inherit', 'inherit']
    });

    // Menunggu pengguna menekan Enter
    await question('');
    logProcess.kill();
}

// Fungsi utama untuk memodifikasi objek di dalam config.json
function editConfig(key, newValue, index = null) {
    if (!fs.existsSync(configFile)) {
        console.log("config.json not found!");
        return;
    }
    try {
        let configData = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

        // Konversi input string menjadi boolean tulen untuk JSON
        if (key === 'autoPoster' || key === 'cleanFilename') {
            configData[key] = newValue === 'true';
        } else if (Array.isArray(configData[key])) {
            if (index === 'add') {
                configData[key].push(newValue);
            } else if (index === 'delete') {
                configData[key].splice(parseInt(newValue), 1);
            } else {
                configData[key][index] = newValue; // Edit elemen yang sudah ada
            }
        } else {
            configData[key] = newValue;
        }

        fs.writeFileSync(configFile, JSON.stringify(configData, null, 2), 'utf-8');
        console.log(`\n✅ Successfully updated '${key}'`);
    } catch (e) {
        console.log("Failed to modify config.json. Ensure the file is not corrupted.");
    }
}

// Loop/putaran utama aplikasi CLI
async function main() {
    const configKeys = ['imdb_id', 'mal_id', 'customText', 'customBigText', 'autoPoster', 'cleanFilename', 'customImage', 'cleanRegex'];

    while (true) {
        clearConsole();
        console.log('=== MPC Discord Presence Menu ===\n');
        console.log(`index.js status: ${getIndexStatus()}`);
        console.log(`${getPm2Table()}\n`);
        console.log(readConfig());
        console.log('\nSelect an option:');
        console.log(`1. ${getIndexStatus() === 'Running' ? 'Stop index.js' : 'Start index.js'}`);
        console.log(`2. View Live Log (PM2)`);

        // Dinamis me-list opsi konfigurasi dari array configKeys
        configKeys.forEach((key, i) => {
            console.log(`${i + 3}. Edit ${key}`);
        });
        console.log('0. Exit\n');

        const choice = await question('Enter your choice: ');

        if (choice === '1') {
            if (getIndexStatus() === 'Running') runNpmCommand('stop');
            else runNpmCommand('start');
            await question('Press Enter to continue...');
        }
        else if (choice === '2') {
            if (getIndexStatus() !== 'Running') {
                console.log('Script is not running.');
                await question('Press Enter to continue...');
            } else await viewLiveLogs();
        }
        else if (configKeys.some((_, i) => choice === String(i + 3))) {
            const index = parseInt(choice) - 3;
            const key = configKeys[index];

            // Tampilkan deskripsi pengaturan yang sedang dipilih
            console.log(`\n--- Editing: ${key} ---`);
            console.log(`Description: ${configDescriptions[key]}`);

            // Baca data config.json terbaru agar sinkron
            let configData = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

            // Logika interaktif khusus untuk Array (customImage & cleanRegex)
            if (Array.isArray(configData[key])) {
                let arrayValues = configData[key];
                console.log(`\nCurrent elements for ${key}:`);
                arrayValues.forEach((val, i) => console.log(`${i + 1}. '${val}'`));
                console.log(`${arrayValues.length + 1}. Add new element`);

                // Safety check: Opsi hapus hanya muncul & bisa diakses jika elemen lebih dari 1
                const canDelete = arrayValues.length > 1;
                if (canDelete) {
                    console.log(`${arrayValues.length + 2}. Delete an element`);
                }
                console.log('0. Back');

                const subChoice = await question('Enter your choice: ');
                if (subChoice === '0') {
                    continue;
                } else if (subChoice === String(arrayValues.length + 1)) {
                    const newVal = await question(`Enter new value to add: `);
                    editConfig(key, newVal, 'add');
                } else if (canDelete && subChoice === String(arrayValues.length + 2)) {
                    const delIndex = await question(`Enter element number to delete (1-${arrayValues.length}): `);
                    const parsedDel = parseInt(delIndex);
                    if (!isNaN(parsedDel) && parsedDel >= 1 && parsedDel <= arrayValues.length) {
                        editConfig(key, String(parsedDel - 1), 'delete');
                    } else {
                        console.log('Invalid element number!');
                    }
                } else {
                    const targetIndex = parseInt(subChoice);
                    if (!isNaN(targetIndex) && targetIndex >= 1 && targetIndex <= arrayValues.length) {
                        const newVal = await question(`Enter new value for element #${targetIndex} (currently '${arrayValues[targetIndex - 1]}'): `);
                        editConfig(key, newVal, targetIndex - 1);
                    } else {
                        console.log('Invalid choice!');
                    }
                }
            }
            // Logika interaktif untuk String dan Boolean biasa
            else {
                let prompt = `Enter new value for ${key}`;
                if (key === 'autoPoster' || key === 'cleanFilename') {
                    const newVal = (await question(`${prompt} (true/false): `)).toLowerCase();
                    if (['true', 'false'].includes(newVal)) {
                        editConfig(key, newVal);
                    } else {
                        console.log("Invalid input! Value must be 'true' or 'false'.");
                    }
                } else {
                    const newVal = await question(`${prompt}: `);
                    editConfig(key, newVal);
                }
            }
            await question('Press Enter to continue...');
        }
        else if (choice === '0') {
            break;
        }
        else {
            console.log('Invalid choice!');
            await question('Press Enter to continue...');
        }
    }
    rl.close();
}

// Menangkap unhandled error agar script tidak force close tanpa jejak
main().catch(err => { console.error('Error:', err); rl.close(); });
