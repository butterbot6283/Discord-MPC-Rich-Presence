const RPC = require('@xhayper/discord-rpc');
const mpc = require('./mpc');
const logger = require('./logger');
const presence = require('./presence');

const mpcId = '1298018501814128796';
let client = null;
let presenceInterval = null;
let isWaitingForDiscord = false;

// Daftarkan fungsi SetActivity Discord ke dalam Mesin Utama
presence.setUpdateCallback(async (payload) => {
    if (client && client.user) {
        // Gunakan .catch() untuk menangkap error asinkron secara diam-diam!
        client.user.setActivity(payload).catch(() => {});
    }
});

function initDiscord() {
    // BERSIHKAN CLIENT LAMA: Hancurkan sisa-sisa agar memori (RAM) tidak bocor
    if (presenceInterval) clearInterval(presenceInterval);
    if (client) {
        try { client.destroy(); } catch (e) {}
    }

    // Buat Instansiasi Klien yang 100% Baru
    client = new RPC.Client({ clientId: mpcId });

    client.on('ready', () => {
        isWaitingForDiscord = false;
        logger.logReady(mpcId);

        presenceInterval = setInterval(async () => {
            const status = await mpc.getMpcStatus(presence.getConfig());
            await presence.handleStatus(status, client);
        }, 5000);
    });

    client.on('disconnected', () => {
        // Pindahkan pesan ke logger agar konsisten dengan gaya log lainnya
        logger.logDiscordDisconnected();
        setTimeout(initDiscord, 5000); // Panggil ulang dari nol, bukan sekadar login ulang
    });

    // Coba Login. Jika gagal, buat klien baru lagi dalam 5 detik
    client.login().catch((err) => {
        if (!isWaitingForDiscord) {
            logger.logDiscordWaiting();
            isWaitingForDiscord = true;
        }
        setTimeout(initDiscord, 5000);
    });
}

initDiscord();
