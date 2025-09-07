const fs = require('fs');
const readline = require('readline');
const { execSync } = require('child_process');
const path = require('path');

const configFile = path.join(__dirname, 'config.js');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Async input wrapper
const question = (query) => new Promise(resolve => rl.question(query, resolve));

// Clear console
function clearConsole() {
    process.stdout.write('\x1Bc');
}

// Read config.js content
function readConfig() {
    let result = 'Current config.js:\n';
    if (!fs.existsSync(configFile)) {
        result += '    config.js not found!\n';
        return result;
    }

    const content = fs.readFileSync(configFile, 'utf-8');
    const lines = content.split('\n');
    let inArray = false;
    let arrayValues = [];
    let currentKey = null;
    let arrayComment = '';
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('module.exports')) return;

        const match = trimmed.match(/^(\w+):\s*(.*?)(,)?\s*(\/\/.*)?$/);
        if (match) {
            const key = match[1];
            let value = match[2].trim();
            let comment = match[4] || '';

            if (key === 'customImage' && value.startsWith('[')) {
                inArray = true;
                currentKey = key;
                arrayValues = [];
                arrayComment = comment;
                if (value.includes(']')) {
                    inArray = false;
                    value = value.substring(1, value.lastIndexOf(']')).trim();
                    arrayValues = value ? value.split(',').map(v => v.trim().replace(/['"]/g, '')) : [];
                    result += `    ${key}: [${arrayValues.join(', ')}] ${comment}\n`;
                }
                return;
            }

            result += `    ${key}: ${value} ${comment}\n`;
        } else if (inArray) {
            if (trimmed.startsWith(']')) {
                inArray = false;
                if (trimmed.includes('//')) {
                    arrayComment = trimmed.substring(trimmed.indexOf('//')).trim();
                }
                result += `    ${currentKey}: [${arrayValues.join(', ')}] ${arrayComment}\n`;
                return;
            }
            const value = trimmed.replace(/,$/, '').trim();
            if (value || value === '') {
                arrayValues.push(value.replace(/['"]/g, ''));
            }
        }
    });

    if (result === 'Current config.js:\n') {
        result += '    [Empty or invalid format]\n';
    }
    return result;
}

// Check index.js status using pm2
function getIndexStatus() {
    try {
        const output = execSync('npx pm2 jlist', { encoding: 'utf-8' });
        const processes = JSON.parse(output);
        const indexProcess = processes.find(proc => proc.name === 'index' && proc.pm2_env.status === 'online');
        return indexProcess ? 'Running' : 'Stopped';
    } catch (err) {
        return 'Stopped';
    }
}

// Get PM2 table (compact)
function getPm2Table() {
    try {
        const output = execSync('npx pm2 jlist', { encoding: 'utf-8' });
        const processes = JSON.parse(output);

        if (processes.length === 0) {
            return '[No PM2 processes found]';
        }

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

// Run PM2 command
function runNpmCommand(command) {
    try {
        if (command === 'start') {
            execSync(`cd "${__dirname}" && npx pm2 start index.js --name index`, { stdio: 'inherit' });
        } else if (command === 'stop') {
            execSync(`cd "${__dirname}" && npx pm2 stop index`, { stdio: 'inherit' });
            execSync(`cd "${__dirname}" && npx pm2 delete index`, { stdio: 'inherit' });
        }
    } catch (err) {
        console.log(`Failed to run pm2 ${command}: ${err.message}`);
        throw err;
    }
}

// Edit config.js
function editConfig(key, newValue, index = null) {
    if (!fs.existsSync(configFile)) {
        console.log("config.js not found!");
        return;
    }

    let lines = fs.readFileSync(configFile, 'utf-8').split('\n');
    let inArray = false;
    let arrayStart = -1;
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].replace(/\r$/, '');
        const match = line.match(/^\s*(\w+):\s*(.*?)(,)?\s*(\/\/.*)?$/);
        if (match) {
            const currentKey = match[1];
            let currentValue = match[2].trim();
            let comment = match[4] || '';
            if (currentKey === key && currentValue.startsWith('[')) {
                inArray = true;
                arrayStart = i;
                let arrayLines = [lines[i]];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith(']')) {
                    arrayLines.push(lines[i]);
                    i++;
                }
                arrayLines.push(lines[i]);

                if (key === 'customImage' && index !== null) {
                    let values = [];
                    for (let al of arrayLines.slice(1, -1)) {
                        let v = al.trim().replace(/,$/, '');
                        if (v || v === '') {
                            v = v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1) : v;
                            values.push(v);
                        }
                    }

                    if (index === 'add') {
                        values.push(newValue);
                    } else if (index === 'delete' && 0 <= parseInt(newValue) < values.length) {
                        values.splice(parseInt(newValue), 1);
                    } else if (0 <= index < values.length) {
                        values[index] = newValue;
                    }

                    arrayLines = [`    ${key}: [ //replace MPC logo with custom images`];
                    values.forEach((v, idx) => {
                        arrayLines.push(`        '${v}'${idx < values.length - 1 ? ',' : ''}`);
                    });
                    arrayLines.push('    ],');
                    lines = [...lines.slice(0, arrayStart), ...arrayLines, ...lines.slice(i + 1)];
                    found = true;
                }

            } else if (match && currentKey === key) {
                if (key === 'useCustomId' || key === 'autoPoster') {
                    newValue = newValue.toLowerCase();
                    if (!['true', 'false'].includes(newValue)) {
                        console.log(`Value for ${key} must be true or false!`);
                        return;
                    }
                } else {
                    if (!newValue.startsWith("'") || !newValue.endsWith("'")) {
                        newValue = `'${newValue}'`;
                    }
                }
                lines[i] = `    ${key}: ${newValue}, ${comment}`;
                found = true;
                break;
            }
        }
    }

    if (!found && key !== 'customImage') {
        lines.splice(lines.length - 1, 0, `    ${key}: ${newValue}, //new entry`);
    }

    fs.writeFileSync(configFile, lines.join('\n'), 'utf-8');
    console.log(`Successfully edited ${key} to ${newValue}`);
}

// Main loop
async function main() {
    const configKeys = [
        'useCustomId', 'customId', 'imdb_id', 'mal_id',
        'autoPoster', 'customText', 'customBigText', 'customType', 'customImage'
    ];

    while (true) {
        clearConsole();
        console.log('=== MPC Discord Presence Menu ===\n');
        console.log(`index.js status: ${getIndexStatus()}`);
        console.log(`${getPm2Table()}\n`);
        console.log(readConfig());
        console.log('\nSelect an option:');
        console.log(`1. ${getIndexStatus() === 'Running' ? 'Stop index.js' : 'Start index.js'}`);
        configKeys.forEach((key, i) => {
            console.log(`${i + 2}. Edit ${key}`);
        });
        console.log('0. Exit');
        console.log();

        const choice = await question('Enter your choice: ');
        if (choice === '1') {
            try {
                if (getIndexStatus() === 'Running') {
                    runNpmCommand('stop');
                    console.log('index.js stopped.');
                } else {
                    runNpmCommand('start');
                    console.log('index.js started.');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    if (getIndexStatus() !== 'Running') {
                        console.log('Failed to start index.js! Check logs with "npx pm2 logs index" or run "node index.js" for debugging.');
                    }
                }
            } catch (err) {
                console.log('Failed to execute command! Check logs with "npx pm2 logs index".');
            }
            await question('Press Enter to continue...');
        } else if (configKeys.some((_, i) => choice === String(i + 2))) {
            const index = parseInt(choice) - 2;
            const key = configKeys[index];
            if (key === 'customImage') {
                const arrayValues = [];
                let comment = '';
                const lines = fs.readFileSync(configFile, 'utf-8').split('\n');
                let inArray = false;
                for (const line of lines) {
                    const match = line.match(/^\s*(\w+):\s*(.*?)(,)?\s*(\/\/.*)?$/);
                    if (match && match[1] === 'customImage' && match[2].startsWith('[')) {
                        inArray = true;
                        comment = match[4] || '';
                        continue;
                    }
                    if (inArray) {
                        if (line.trim().startsWith(']')) {
                            inArray = false;
                            break;
                        }
                        const value = line.trim().replace(/,$/, '');
                        if (value || value === '') {
                            arrayValues.push(value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value);
                        }
                    }
                }

                console.log(`\nSelect element for ${key}:`);
                arrayValues.forEach((value, i) => {
                    console.log(`${i + 1}. '${value}'`);
                });
                console.log(`${arrayValues.length + 1}. Add new element`);
                if (arrayValues.length > 1) { 
                    console.log(`${arrayValues.length + 2}. Delete element`);
                }
                console.log('0. Back');
                const subChoice = await question('Enter your choice: ');

                if (subChoice === '0') {
                    continue;
                } else if (subChoice === String(arrayValues.length + 1)) {
                    const newValue = await question('Enter new URL for customImage (leave blank for empty element): ');
                    editConfig(key, newValue, 'add');
                } else if (arrayValues.length > 1 && subChoice === String(arrayValues.length + 2)) {
                    const delIndex = await question(`Enter element number to delete (1-${arrayValues.length}): `);
                    if (delIndex.match(/^\d+$/) && 1 <= parseInt(delIndex) && parseInt(delIndex) <= arrayValues.length) {
                        editConfig(key, String(parseInt(delIndex) - 1), 'delete');
                    } else {
                        console.log('Invalid choice!');
                        await question('Press Enter to continue...');
                    }
                } else if (subChoice.match(/^\d+$/) && 1 <= parseInt(subChoice) && parseInt(subChoice) <= arrayValues.length) {
                    const newValue = await question(`Enter new value for '${arrayValues[parseInt(subChoice) - 1]}' (leave blank for empty): `);
                    editConfig(key, newValue, parseInt(subChoice) - 1);
                } else {
                    console.log('Invalid choice!');
                    await question('Press Enter to continue...');
                }
            } else {
                let prompt = `Enter new value for ${key}`;
                if (key === 'useCustomId' || key === 'autoPoster') {
                    prompt += ' (true/false): ';
                    const newValue = (await question(prompt)).toLowerCase();
                    if (!['true', 'false'].includes(newValue)) {
                        console.log(`Value for ${key} must be true or false!`);
                        await question('Press Enter to continue...');
                        continue;
                    }
                    editConfig(key, newValue);
                } else {
                    prompt += ': ';
                    const newValue = await question(prompt);
                    editConfig(key, newValue);
                }
                await question('Press Enter to continue...');
            }
        } else if (choice === '0') {
            break;
        } else {
            console.log('Invalid choice!');
            await question('Press Enter to continue...');
        }
    }
    rl.close();
}

// Run main
main().catch(err => {
    console.error('Error:', err);
    rl.close();
});