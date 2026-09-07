const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const yts = require('yt-search');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const { Sticker, createSticker, StickerTypes } = require("wa-sticker-formatter");
const webp = require('node-webpmux');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const FormData = require("form-data");
const os = require('os');
const { sms, downloadMediaMessage } = require("./msg");
const FileType = require('file-type');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_REACT: 'false',
    ANTI_LINK: 'true',

    AUTO_LIKE_EMOJI: [
        '❤️', '💚', '🌚', '😍', '💀', '🧡',
        '💛', '💙', '👻', '🖤', '🤍', '🥀'
    ],

    REACTXEMOJIS: [
        '😂', '❤️', '🔥', '👏', '😮', '😢',
        '🤣', '👍', '🎉', '🤔', '🙏', '😍',
        '😊', '🥰', '💕', '🤩', '✨', '😎',
        '🥳', '🙌'
    ],

    PREFIX: '.',

    BOT_NAME: 'ALEXA-MINI',
    VERSION: '3.0.0 Stable',
    OWNER_NAME: 'Watson Fourpence',

    MAX_RETRIES: 3,
    ADMIN_LIST_PATH: './admin.json',
    IK_IMAGE_PATH: './watson-md.jpg',
    NEWSLETTER_JID: '1203634182392851@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '263781330745',

    CHANNEL_LINK:
        'https://whatsapp.com/channel/0029VbB0E2MBvvsiMnWBM72n',

    DEFAULT_SETTINGS: {
        AUTO_VIEW_STATUS: 'true',
        AUTO_LIKE_STATUS: 'true',
        AUTO_RECORDING: 'false',
        AUTO_REACT: 'false',
        ANTI_LINK: 'true',
        MODE: 'public',
        PREFIX: '.',

        BOT_NAME: 'ALEXA-MINI',
        VERSION: '3.0.0 Stable',
        OWNER_NAME: 'Watson Fourpence',

        AUTO_LIKE_EMOJI: [
            '❤️', '💚', '🌚', '😍', '💀', '🧡',
            '💛', '💙', '👻', '🖤', '🤍', '🥀'
        ],

        REACTXEMOJIS: [
            '😂', '❤️', '🔥', '👏', '😮', '😢',
            '🤣', '👍', '🎉', '🤔', '🙏', '😍',
            '😊', '🥰', '💕', '🤩', '✨', '😎',
            '🥳', '🙌'
        ]
    }
};

// ─────────────────────────────
// FIX FOR: owner is not defined / isOwner is not defined
// ─────────────────────────────
const OWNER_NUMBERS = [config.OWNER_NUMBER].flat().map(n => n.replace(/[^0-9]/g, ''));

function getSanitizedNumber(jid = '') {
    return jid.split('@')[0].replace(/[^0-9]/g, '');
}

function isOwnerCheck(jid, fromMe = false) {
    if (fromMe) return true;
    const num = getSanitizedNumber(jid);
    return OWNER_NUMBERS.some(o => num.includes(o) || o.includes(num));
}

// prevent ReferenceError for userConfig / sanitizedNumber
let userConfig = {...config.DEFAULT_SETTINGS };
async function updateUserConfig(number, newConf) {
    try {
        userConfig = newConf;
        return true;
    } catch { return false; }
}
// ─────────────────────────────
// END FIX
// ─────────────────────────────

// ─────────────────────────────
// GITHUB
// ─────────────────────────────

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

const footer = 'ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ';
const githubOwner = 'watsonx';
const repo = 'watson-dev1';

// ─────────────────────────────
// GLOBAL STORAGE
// ─────────────────────────────

const activeSockets = new Map();
const socketCreationTime = new Map();
const groupSettings = new Map();

const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

const otpStore = new Map();


// ─────────────────────────────
// BOT GLOBAL CONFIG VALUES
// DO NOT DECLARE botName/owner AGAIN
// ─────────────────────────────

const botName =
    config?.BOT_NAME ||
    'ALEXA-MINI';

const botVersion =
    config?.VERSION ||
    '3.0.0 Stable';
    
const botImage =
            config?.IK_IMAGE_PATH ||
            config?.IMAGE_PATH ||
            'https://files.catbox.moe/2q6j6k.jpg';

const ownerName =
    config?.OWNER_NAME ||
    'Watson Fourpence';


// ─────────────────────────────
// SESSION DIRECTORY
// ─────────────────────────────

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, {
        recursive: true
    });
}


// ─────────────────────────────
// 👥 GROUP PARTICIPANT HANDLERS
// WELCOME / GOODBYE
// ─────────────────────────────

function setupGroupParticipantHandlers(socket) {

    socket.ev.on(
        'group-participants.update',
        async (update) => {

            try {

                const {
                    id,
                    participants,
                    action
                } = update;


                // ─────────────────────────
                // GET GROUP SETTINGS
                // ─────────────────────────

                const settings =
                    groupSettings.get(id) || {
                        welcome: true,
                        goodbye: true
                    };


                // ─────────────────────────
                // GET GROUP INFORMATION
                // ─────────────────────────

                const metadata =
                    await socket.groupMetadata(id);

                const groupName =
                    metadata.subject || 'Group';


                // ─────────────────────────
                // 👋 NEW MEMBER
                // ─────────────────────────

                if (
                    action === 'add' &&
                    settings.welcome
                ) {

                    for (
                        const participant
                        of participants
                    ) {

                        const number =
                            participant.split('@')[0];

                        const welcomeText =
`╭━━━〔 👋 WELCOME 〕━━━╮
┃
┃ Hey @${number}! 🥰
┃
┃ Welcome to:
┃ *${groupName}*
┃
┃ 📜 Please check the group rules.
┃ 🤖 I'm ${botName}.
┃
┃ Enjoy your stay! ❤️
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;

                        await socket.sendMessage(
                            id,
                            {
                                text: welcomeText,
                                mentions: [
                                    participant
                                ]
                            }
                        );
                    }
                }


                // ─────────────────────────
                // 👋 MEMBER LEFT
                // ─────────────────────────

                if (
                    (
                        action === 'remove' ||
                        action === 'leave'
                    ) &&
                    settings.goodbye
                ) {

                    for (
                        const participant
                        of participants
                    ) {

                        const number =
                            participant.split('@')[0];

                        const goodbyeText =
`╭━━━〔 👋 GOODBYE 〕━━━╮
┃
┃ @${number} has left the group.
┃
┃ 👋 Goodbye and take care!
┃
┃ *${groupName}*
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;

                        await socket.sendMessage(
                            id,
                            {
                                text: goodbyeText,
                                mentions: [
                                    participant
                                ]
                            }
                        );
                    }
                }

            } catch (error) {

                console.error(
                    'GROUP PARTICIPANT ERROR:',
                    error
                );
            }
        }
    );
}


// ─────────────────────────────
// LOAD ADMINS
// ─────────────────────────────

function loadAdmins() {

    try {

        if (
            fs.existsSync(
                config.ADMIN_LIST_PATH
            )
        ) {

            return JSON.parse(
                fs.readFileSync(
                    config.ADMIN_LIST_PATH,
                    'utf8'
                )
            );
        }

        return [];

    } catch (error) {

        console.error(
            'Failed to load admin list:',
            error
        );

        return [];
    }
}


// ─────────────────────────────
// FORMAT MESSAGE
// ─────────────────────────────

function formatMessage(
    title,
    content,
    footer
) {

    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}


// ─────────────────────────────
// GENERATE OTP
// ─────────────────────────────

function generateOTP() {

    return Math.floor(
        100000 +
        Math.random() * 900000
    ).toString();
}


// ─────────────────────────────
// TIME
// ─────────────────────────────

function getPakistanTimestamp() {

    return moment()
        .tz('Africa/Harare')
        .format(
            'YYYY-MM-DD HH:mm:ss'
        );
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file =>
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

let totalcmds = async () => {
  try {
    const filePath = "./pair.js";
    const mytext = await fs.readFile(filePath, "utf-8");
    const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
    const lines = mytext.split("\n");
    let count = 0;
    for (const line of lines) {
      if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
      if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
        count++;
      }
    }
    return count;
  } catch (error) {
    console.error("Error reading pair.js:", error.message);
    return 0;
  }
}

// ─────────────────────────────
// ALEXA-MIN TEXT TO SPEECH
// ─────────────────────────────

async function generateTTS(text) {
    try {
        const url = googleTTS.getAudioUrl(
            text,
            {
                lang: 'en',
                slow: false,
                host: 'https://translate.google.com'
            }
        );

        const response = await axios.get(
            url,
            {
                responseType: 'arraybuffer',
                timeout: 15000
            }
        );

        return Buffer.from(response.data);

    } catch (error) {
        console.error(
            'TTS ERROR:',
            error.message
        );

        return null;
    }
}


// ─────────────────────────────
// YOUR EXISTING OTP FUNCTION
// ─────────────────────────────

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'ᗩᒪE᙭ᗩ-ᗰIᑎ'
    );
    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;

        try {
            const emojis = ['❤️', '💚', '👍', '🗿', '💀'];

            const randomEmoji =
                emojis[Math.floor(Math.random() * emojis.length)];

            const messageId =
                message.newsletterServerId;

            if (!messageId) {
                console.warn(
                    'No valid ServerId found:',
                    message
                );
                return;
            }

            let retries =
                config.MAX_RETRIES;

            while (retries > 0) {
                try {

                    await socket.newsletterReactMessage(
                        config.NEWSLETTER_JID,
                        messageId.toString(),
                        randomEmoji
                    );

                    console.log(
                        `Reacted to newsletter message ${messageId} with ${randomEmoji}`
                    );

                    break;

                } catch (error) {

                    retries--;

                    console.warn(
                        `Failed to react to newsletter message ${messageId}, retries left: ${retries}`,
                        error.message
                    );

                    if (retries === 0) {
                        throw error;
                    }

                    await delay(
                        2000 *
                        (config.MAX_RETRIES - retries)
                    );
                }
            }

        } catch (error) {

            console.error(
                'Newsletter reaction error:',
                error
            );
        }
    });
}

async function setupStatusHandlers(socket, userConfig) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid!== 'status@broadcast' ||!message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;
        try {
            if (userConfig.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }
            if (userConfig.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
            if (userConfig.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = userConfig.AUTO_LIKE_EMOJI[Math.floor(Math.random() * userConfig.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴠɪᴇᴡ ᴏɴᴄᴇ ᴍᴇssᴀɢᴇs!*'
        });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *Not a valid view-once message, love!* 😢'
            });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu);
    } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

function setupCommandHandlers(socket, number, userConfig) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage')? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        if (userConfig.AUTO_REACT === 'true' &&!msg.key.fromMe) {
            try {
                const randomReaction = userConfig.REACTXEMOJIS[Math.floor(Math.random() * userConfig.REACTXEMOJIS.length)];
                await m.react(randomReaction);
                console.log(`Auto-reacted with ${randomReaction} to message from ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Auto-react error:', error);
            }
        }
        const senderNumber = (msg.key.fromMe? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid)).split('@')[0];
        if (senderNumber.includes("263781330745") &&!msg.key.fromMe) {
            const reactions = ["💸", "🇿🇼", "🦢", "✔️", "👌", "😎", "❤️"];
            const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
            m.react(randomReaction);
        }
const quoted =
    type === "extendedTextMessage" &&
    msg.message.extendedTextMessage.contextInfo!= null
       ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
        : [];
const body =
    (type === "conversation")? msg.message.conversation
    : (type === "extendedTextMessage")? msg.message.extendedTextMessage.text
    : (type === "interactiveResponseMessage")?
        JSON.parse(msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}')?.id
    : (type === "templateButtonReplyMessage")?
        msg.message.templateButtonReplyMessage?.selectedId
    : (type === "imageMessage")?
        msg.message.imageMessage?.caption || ''
    : (type === "videoMessage")?
        msg.message.videoMessage?.caption || ''
    : (type === "buttonsResponseMessage")?
        msg.message.buttonsResponseMessage?.selectedButtonId
    : (type === "listResponseMessage")?
        msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
    : (type === "messageContextInfo")?
        (msg.message.buttonsResponseMessage?.selectedButtonId ||
        msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msg.text)
    : (type === "viewOnceMessage")?
        msg.message[type]?.message?.[getContentType(msg.message[type].message)] || ''
    : (type === "viewOnceMessageV2")?
        (msg.message[type]?.message?.imageMessage?.caption ||
         msg.message[type]?.message?.videoMessage?.caption || "")
    : "";
const sender = msg.key.remoteJid;
const nowsender = msg.key.fromMe
   ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id)
    : (msg.key.participant || msg.key.remoteJid);
const developers = `${config.OWNER_NUMBER}`;
const botNumber = socket.user.id.split(':')[0];
const isbot = botNumber.includes(senderNumber);
const isOwner = isbot? isbot : developers.includes(senderNumber);
let prefix = userConfig.PREFIX;
let isCmd = body.startsWith(prefix);
const from = msg.key.remoteJid;
const isGroup = from.endsWith("@g.us");
async function isGroupAdmin(jid, user) {
    try {
        const groupMetadata = await socket.groupMetadata(jid);
        const participant = groupMetadata.participants.find(p => p.id === user);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
    } catch (error) {
        console.error('Error checking group admin status:', error);
        return false;
    }
}
async function isBotGroupAdmin(jid) {
    try {
        const groupMetadata = await socket.groupMetadata(jid);
        const botParticipant = groupMetadata.participants.find(p => p.id === socket.user.id);
        return botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin' || false;
    } catch (error) {
        console.error('Error checking bot admin status:', error);
        return false;
    }
}
const isSenderGroupAdmin = isGroup? await isGroupAdmin(from, nowsender) : false;
const isBotAdmin = isGroup? await isBotGroupAdmin(from) : false;
try {
    if (isGroup && userConfig.ANTI_LINK === 'true' &&!isSenderGroupAdmin && isBotAdmin &&!msg.key.fromMe) {
        const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/[^\s]*)?)/gi;
        if (urlRegex.test(body)) {
            await socket.sendMessage(from, { delete: msg.key });
            await socket.sendMessage(from, {
                text: `⚠️ *LINK DETECTED*\n@${senderNumber} Links are not allowed in this group!\nYou have been removed.`,
                mentions: [nowsender]
            }, { quoted: msg });
            await socket.groupParticipantsUpdate(from, [nowsender], 'remove');
            console.log(`Removed ${senderNumber} for sending link in group ${from}`);
            return;
        }
    }
} catch (error) {
    console.error('Anti-link error:', error);
}
if (isCmd) {
    if (userConfig.MODE === 'private' &&!isOwner) {
        return;
    }
    if (userConfig.MODE === 'inbox' && isGroup) {
        await socket.sendMessage(sender, {
            text: `❌ Commands are disabled in groups. Current mode: *${userConfig.MODE}*`
        }, { quoted: msg });
        return;
    }
    prefix = userConfig.PREFIX;
    isCmd = body.startsWith(prefix);
}
const command = isCmd? body.slice(prefix.length).trim().split(' ')[0].toLowerCase() : '';
const args = body.trim().split(/ +/).slice(1);
socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    const quotedMsg = message.msg? message.msg : message;
    const mime = (message.msg || message).mimetype || '';
    const messageType = message.mtype? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(quotedMsg, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const type = await FileType.fromBuffer(buffer);
    const trueFileName = attachExtension? `${filename}.${type.ext}` : filename;
    fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
};
if (!command) return;
const count = await totalcmds();
const fakevCard = {
    key: {
        fromMe: false,
        participant: "0@s.whatsapp.net",
        remoteJid: "status@broadcast"
    },
    message: {
        contactMessage: {
            displayName: "ALEXA-MIN",
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=263781330745:+263789622747\nEND:VCARD`
                        }
            }
        };
        try {
            switch (command) {
                case 'settings':
                case 'setting':
                case 'env':
                case 'config': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
                        break;
                    }
                    const settingsText = `> *ALEXA-MIN Sᴇᴛᴛɪɴɢs* ⚙️\n\n🔹 *Aᴜᴛᴏ Vɪᴇᴡ Sᴛᴀᴛᴜs:* ${userConfig.AUTO_VIEW_STATUS}\n🔹 *Aᴜᴛᴏ Lɪᴋᴇ Sᴛᴀᴛᴜs:* ${userConfig.AUTO_LIKE_STATUS}\n🔹 *Aᴜᴛᴏ Rᴇᴄᴏʀᴅɪɴɢ:* ${userConfig.AUTO_RECORDING}\n🔹 *Aᴜᴛᴏ Rᴇᴀᴄᴛ:* ${userConfig.AUTO_REACT}\n🔹 *Aɴᴛɪ Lɪɴᴋ:* ${userConfig.ANTI_LINK}\n🔹 *Bᴏᴛ Mᴏᴅᴇ:* ${userConfig.MODE}\n🔹 *Pʀᴇғɪx:* ${userConfig.PREFIX}\n\n📋 *Aᴠᴀɪʟᴀʙʟᴇ Cᴏᴍᴍᴀɴᴅs:*\n\n• ${userConfig.PREFIX}statusview on/off\n• ${userConfig.PREFIX}statuslike on/off\n• ${userConfig.PREFIX}recording on/off\n• ${userConfig.PREFIX}autoreact on/off\n• ${userConfig.PREFIX}antilink on/off\n• ${userConfig.PREFIX}mode public/private/inbox\n• ${userConfig.PREFIX}prefix <new_prefix>\n\n> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`;
                    await socket.sendMessage(sender, {
                        image: { url: config.IK_IMAGE_PATH },
                        caption: settingsText,
                        contextInfo: {
                            mentionedJid: [msg.sender],
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '1203634182592851@newsletter',
                                newsletterName: 'ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ',
                                serverMessageId: 143
                            }
                        }
                    }, { quoted: msg });
                    break;
                }
case 'statusview':
case 'autoview': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
        break;
    }
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}autoview on/off\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.AUTO_VIEW_STATUS}`
        }, { quoted: msg });
    }
    const value = args[0].toLowerCase();
    if (value!== 'on' && value!== 'off') {
        return await socket.sendMessage(sender, {
            text: '❌ *Pʟᴇᴀsᴇ ᴜsᴇ:* on ᴏʀ off'
        }, { quoted: msg });
    }
    const newValue = value === 'on'? 'true' : 'false';
    userConfig.AUTO_VIEW_STATUS = newValue;
    await updateUserConfig(sanitizedNumber, userConfig);
    await socket.sendMessage(sender, {
        text: `✅ *Aᴜᴛᴏ Vɪᴇᴡ Sᴛᴀᴛᴜs sᴇᴛ ᴛᴏ:* ${newValue}`
    }, { quoted: msg });
    break;
}
case 'statuslike':
case 'autolike': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
        break;
    }
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}autolike on/off\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.AUTO_LIKE_STATUS}`
        }, { quoted: msg });
    }
    const value = args[0].toLowerCase();
    if (value!== 'on' && value!== 'off') {
        return await socket.sendMessage(sender, {
            text: '❌ *Pʟᴇᴀsᴇ ᴜsᴇ:* on ᴏʀ off'
        }, { quoted: msg });
    }
    const newValue = value === 'on'? 'true' : 'false';
    userConfig.AUTO_LIKE_STATUS = newValue;
    await updateUserConfig(sanitizedNumber, userConfig);
    await socket.sendMessage(sender, {
        text: `✅ *Aᴜᴛᴏ Lɪᴋᴇ Sᴛᴀᴛᴜs sᴇᴛ ᴛᴏ:* ${newValue}`
    }, { quoted: msg });
    break;
}
                case 'autoreact':
case 'autoreaction':
case 'reactauto': {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*'
        }, { quoted: msg });
        break;
    }

    if (!args[0]) {
        const status = userConfig.AUTO_REACT === true || userConfig.AUTO_REACT === 'true'
            ? 'on'
            : 'off';

        await socket.sendMessage(sender, {
            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}autoreact on/off\n*Cᴜʀʀᴇɴᴛ:* ${status.toUpperCase()}`
        }, { quoted: msg });
        break;
    }

    const value = String(args[0]).toLowerCase().trim();

    if (!['on', 'off'].includes(value)) {
        await socket.sendMessage(sender, {
            text: '❌ *Pʟᴇᴀsᴇ ᴜsᴇ:* on ᴏʀ off'
        }, { quoted: msg });
        break;
    }

    // Store as a real Boolean, not a string
    userConfig.AUTO_REACT = value === 'on';

    await updateUserConfig(sanitizedNumber, userConfig);

    await socket.sendMessage(sender, {
        text: userConfig.AUTO_REACT
            ? '✅ *Aᴜᴛᴏ Rᴇᴀᴄᴛ ᴇɴᴀʙʟᴇᴅ!* ❤️\n\nThe bot will now automatically react to incoming messages.'
            : '✅ *Aᴜᴛᴏ Rᴇᴀᴄᴛ ᴅɪsᴀʙʟᴇᴅ!* ❌\n\nThe bot will no longer automatically react to incoming messages.'
    }, { quoted: msg });

    break;
}
                case 'antilink':
case 'linkblock': {
    const fs = require('fs-extra');
    const path = require('path');
    try {
        const ownerCheck = typeof isOwner!== 'undefined'? isOwner : false;
        if (!ownerCheck) return await socket.sendMessage(sender, { text: "*📛 Owner only.*" }, { quoted: msg });

        const current = (typeof userConfig!== 'undefined'? userConfig.ANTI_LINK : config?.ANTI_LINK) || 'false';
        const prefix = config?.PREFIX || '.';

        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: `📌 *Usage:* ${prefix}antilink on/off\n*Current:* ${current}\n\nWhen ON: Bot deletes links + removes sender (admin needed)`
            }, { quoted: msg });
        }

        const value = args[0].toLowerCase();
        if (!['on','off'].includes(value)) return await socket.sendMessage(sender, { text: '❌ Use: on or off' }, { quoted: msg });

        const newValue = value === 'on'? 'true' : 'false';

        // Save safely
        if (typeof updateUserConfig === 'function' && typeof sanitizedNumber!== 'undefined') {
            userConfig.ANTI_LINK = newValue;
            await updateUserConfig(sanitizedNumber, userConfig);
        } else {
            config.ANTI_LINK = newValue;
        }
        if(config) config.ANTI_LINK = newValue;

        await socket.sendMessage(sender, { text: `✅ *Anti-Link:* ${newValue.toUpperCase()}\n${newValue==='true'?'🛡️ Active - will delete links':'💤 Disabled'}` }, { quoted: msg });

    } catch(e){ await socket.sendMessage(sender,{text:`❌ ${e.message}`},{quoted:msg}); }
    break;
}
case 'recording':
case 'autorecording':
case 'autorecord': {
    try {
        const senderJid = msg.key.participant || sender;
        const sanitizedNumber = getSanitizedNumber(senderJid);
        const isOwner = isOwnerCheck(senderJid, msg.key.fromMe);

        if (!isOwner) return await socket.sendMessage(sender, { text: "*📛 Owner only.*" }, { quoted: msg });

        const current = userConfig.AUTO_RECORDING || config.AUTO_RECORDING || 'false';
        const prefix = config.PREFIX || '.';

        if (!args[0]) {
            return await socket.sendMessage(sender, { text: `📌 Usage: ${prefix}autorecord on/off\nCurrent: ${current}` }, { quoted: msg });
        }

        const value = args[0].toLowerCase();
        if (!['on','off'].includes(value)) return await socket.sendMessage(sender, { text: '❌ Use on/off' }, { quoted: msg });

        const newValue = value === 'on'? 'true' : 'false';

        userConfig.AUTO_RECORDING = newValue;
        await updateUserConfig(sanitizedNumber, userConfig);
        config.AUTO_RECORDING = newValue;

        await socket.sendMessage(sender, { text: `✅ *Auto-Recording:* ${newValue.toUpperCase()}` }, { quoted: msg });

    } catch(e){ await socket.sendMessage(sender,{text:`❌ ${e.message}`},{quoted:msg}); }
    break;
}
case 'lyrics':
case 'lyric': {
    try {
        if (!args.length) {
            return await socket.sendMessage(sender, {
                text: `📌 *Usage:* ${userConfig.PREFIX}lyrics <song name>\n\n🎵 *Example:* ${userConfig.PREFIX}lyrics Calm Down`
            }, { quoted: msg });
        }

        const query = args.join(' ');

        await socket.sendMessage(sender, {
            text: `🔎 *Searching lyrics...*\n\n🎵 ${query}`
        }, { quoted: msg });

        const apiUrl = `https://eliteprotech-apis.zone.id/lyrics?query=${encodeURIComponent(query)}`;

        const response = await axios.get(apiUrl, {
            timeout: 30000
        });

        if (!response.data?.success || !response.data?.result?.length) {
            return await socket.sendMessage(sender, {
                text: '❌ *Lyrics not found.*'
            }, { quoted: msg });
        }

        const song = response.data.result[0];

        const title = song.trackName || song.name || query;
        const artist = song.artistName || 'Unknown';
        const album = song.albumName || 'Unknown';

        let lyrics = song.plainLyrics || '';

        if (!lyrics) {
            return await socket.sendMessage(sender, {
                text: `❌ *Lyrics not available for:* ${title}`
            }, { quoted: msg });
        }

        const duration = song.duration
            ? `${Math.floor(song.duration / 60)}:${String(song.duration % 60).padStart(2, '0')}`
            : 'Unknown';

        const text =
`╭━━━〔 🎵 *ALEXA-MINI LYRICS* 〕━━━╮
┃
┃ 🎶 *Title:* ${title}
┃ 👤 *Artist:* ${artist}
┃ 💿 *Album:* ${album}
┃ ⏱️ *Duration:* ${duration}
┃
╰━━━━━━━━━━━━━━━━━━━━╯

🎤 *Lyrics:*

${lyrics}`;

        await socket.sendMessage(sender, {
            text
        }, { quoted: msg });

    } catch (error) {
        console.error('LYRICS ERROR:', error);

        await socket.sendMessage(sender, {
            text: `❌ *Lyrics Error:*\n${error.message || 'Something went wrong.'}`
        }, { quoted: msg });
    }

    break;
}
case 'update':
case 'gitpull': {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*'
        }, { quoted: msg });
        break;
    }

    const UPDATE_URL = 'https://github.com/Tinashex/webtes/archive/refs/heads/main.zip';
    const ROOT_DIR = process.cwd();
    const TEMP_ZIP = path.join(ROOT_DIR, '.watson-update.zip');
    const TEMP_DIR = path.join(ROOT_DIR, '.watson-update');
    const BACKUP_DIR = path.join(ROOT_DIR, '.watson-backup');

    const preserve = [
        'node_modules',
        '.env',
        '.git',
        '.watson-update.zip',
        '.watson-update',
        '.watson-backup',
        'session',
        'sessions',
        'auth_info_baileys',
        'auth_info',
        'auth',
        'creds.json',
        'admin.json',
        'config.json'
    ];

    try {
        await socket.sendMessage(sender, {
            text: '🔄 *WATSON-XD UPDATE*\n\n📦 Checking GitHub for the latest version...'
        }, { quoted: msg });

        if (fs.existsSync(TEMP_ZIP)) {
            fs.removeSync(TEMP_ZIP);
        }

        if (fs.existsSync(TEMP_DIR)) {
            fs.removeSync(TEMP_DIR);
        }

        await socket.sendMessage(sender, {
            text: '⬇️ *Downloading latest files from GitHub...*'
        }, { quoted: msg });

        const response = await axios.get(UPDATE_URL, {
            responseType: 'arraybuffer',
            timeout: 180000,
            maxContentLength: 250 * 1024 * 1024,
            maxBodyLength: 250 * 1024 * 1024
        });

        if (!response.data || response.data.length < 100) {
            throw new Error('GitHub returned an invalid update file.');
        }

        fs.writeFileSync(TEMP_ZIP, response.data);

        await socket.sendMessage(sender, {
            text: '📦 *Extracting update files...*'
        }, { quoted: msg });

        const zip = new AdmZip(TEMP_ZIP);
        zip.extractAllTo(TEMP_DIR, true);

        const extracted = fs.readdirSync(TEMP_DIR);

        if (!extracted.length) {
            throw new Error('The GitHub update archive is empty.');
        }

        let githubRoot = path.join(TEMP_DIR, extracted[0]);

        if (!fs.existsSync(githubRoot) || !fs.statSync(githubRoot).isDirectory()) {
            githubRoot = TEMP_DIR;
        }

        const githubFiles = fs.readdirSync(githubRoot);

        if (!githubFiles.length) {
            throw new Error('No project files were found in the GitHub update.');
        }

        await socket.sendMessage(sender, {
            text: '💾 *Creating backup of current bot files...*'
        }, { quoted: msg });

        if (fs.existsSync(BACKUP_DIR)) {
            fs.removeSync(BACKUP_DIR);
        }

        fs.mkdirSync(BACKUP_DIR, {
            recursive: true
        });

        const currentFiles = fs.readdirSync(ROOT_DIR);

        for (const item of currentFiles) {
            if (preserve.includes(item)) {
                continue;
            }

            const source = path.join(ROOT_DIR, item);
            const backup = path.join(BACKUP_DIR, item);

            try {
                fs.moveSync(source, backup, {
                    overwrite: true
                });
            } catch (backupError) {
                console.error(`Backup error for ${item}:`, backupError.message);
            }
        }

        await socket.sendMessage(sender, {
            text: '📥 *Installing latest GitHub version...*'
        }, { quoted: msg });

        for (const item of githubFiles) {
            if (preserve.includes(item)) {
                continue;
            }

            const source = path.join(githubRoot, item);
            const destination = path.join(ROOT_DIR, item);

            try {
                fs.copySync(source, destination, {
                    overwrite: true
                });
            } catch (copyError) {
                console.error(`Update error for ${item}:`, copyError.message);
                throw copyError;
            }
        }

        if (fs.existsSync(TEMP_ZIP)) {
            fs.removeSync(TEMP_ZIP);
        }

        if (fs.existsSync(TEMP_DIR)) {
            fs.removeSync(TEMP_DIR);
        }

        await socket.sendMessage(sender, {
            text:
                '╭━━━〔 *WATSON-XD UPDATE* 〕━━━╮\n' +
                '┃\n' +
                '┃ ✅ Update completed successfully\n' +
                '┃ 📦 Repository: Tinashex/webtes\n' +
                '┃ 🌿 Branch: main\n' +
                '┃ 💾 Backup: Created\n' +
                '┃ 🔐 Sessions: Preserved\n' +
                '┃ ⚙️ Config: Preserved\n' +
                '┃\n' +
                '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
                '🔄 *Restarting bot...*\n' +
                '⏳ Please wait...'
        }, { quoted: msg });

        setTimeout(() => {
            console.log('====================================');
            console.log('🔄 WATSON-XD-BOT RESTARTING...');
            console.log('====================================');

            process.kill(process.pid, 'SIGTERM');
        }, 3000);

    } catch (error) {
        console.error('====================================');
        console.error('❌ GITHUB UPDATE ERROR');
        console.error(error);
        console.error('====================================');

        try {
            if (fs.existsSync(TEMP_ZIP)) {
                fs.removeSync(TEMP_ZIP);
            }

            if (fs.existsSync(TEMP_DIR)) {
                fs.removeSync(TEMP_DIR);
            }
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError.message);
        }

        await socket.sendMessage(sender, {
            text:
                '╭━━━〔 *UPDATE FAILED* 〕━━━╮\n' +
                '┃\n' +
                `┃ ❌ ${error.message || 'Unknown error'}\n` +
                '┃\n' +
                '┃ 🛡️ Existing bot files were\n' +
                '┃ not intentionally removed.\n' +
                '┃\n' +
                '╰━━━━━━━━━━━━━━━━━━━━━━╯'
        }, { quoted: msg });
    }

    break;
}
case 'artist':
case 'artistinfo': {
try {
if (!args.length) {
await socket.sendMessage(sender, {
text: "📌 *Usage:* ${userConfig.PREFIX}artist <artist name>\n\n👤 *Example:*\n${userConfig.PREFIX}artist Rema"
}, { quoted: msg });
break;
}

    const query = args.join(' ');

    const search = await yts(query);

    if (!search?.videos?.length) {
        await socket.sendMessage(sender, {
            text: `❌ *No information found for:* ${query}`
        }, { quoted: msg });
        break;
    }

    const video = search.videos[0];
    const artist = video.author;

    await socket.sendMessage(sender, {
        text:

`╭━━━〔 👤 ARTIST INFO 〕━━━╮
┃
┃ 👤 Artist: ${artist?.name || query}
┃ 📺 Channel: ${artist?.name || 'Unknown'}
┃ 🔗 Channel URL: ${artist?.url || 'Unknown'}
┃
╰━━━━━━━━━━━━━━━━━━━━╯

🎵 Latest Search Result:

${video.title}
⏱️ ${video.timestamp || 'Unknown'}
🔗 ${video.url}`
}, { quoted: msg });

} catch (error) {
    console.error('ARTIST ERROR:', error);

    await socket.sendMessage(sender, {
        text: `❌ *Artist Error:*\n${error.message || 'Something went wrong.'}`
    }, { quoted: msg });
}

break;

}
case 'play':
case 'song': {
    try {
        if (!args.length) {
            return await socket.sendMessage(sender, {
                text: `📌 *Usage:* ${userConfig.PREFIX}play <song name>\n\n🎵 Example:\n${userConfig.PREFIX}play Mwana Wese`
            }, { quoted: msg });
        }

        const query = args.join(' ');

        await socket.sendMessage(sender, {
            text: `🔎 *Searching YouTube...*\n\n🎵 *Song:* ${query}`
        }, { quoted: msg });

        // YouTube search
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const searchPage = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const html = searchPage.data;

        const match = html.match(/"videoId":"([^"]+)"/);

        if (!match) {
            return await socket.sendMessage(sender, {
                text: '❌ *Song not found on YouTube.*'
            }, { quoted: msg });
        }

        const videoId = match[1];
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Your MP3 API
        const apiUrl = `https://eliteprotech-apis.zone.id/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;

        const response = await axios.get(apiUrl, {
            timeout: 60000
        });

        if (!response.data?.status || !response.data?.download?.downloadUrl) {
            return await socket.sendMessage(sender, {
                text: '❌ *Failed to download this song.*'
            }, { quoted: msg });
        }

        const song = response.data.download;

        // Send thumbnail + song information
        await socket.sendMessage(sender, {
            image: {
                url: song.thumbnail
            },
            caption:
`╭━━━〔 🎵 *ALEXA-MINI PLAY* 〕━━━╮
┃
┃ 🎶 *Title:* ${song.title}
┃ ⏱️ *Duration:* ${song.duration || 'Unknown'}
┃ 🎧 *Format:* MP3
┃
┃ 🔗 *YouTube:* ${youtubeUrl}
┃
╰━━━━━━━━━━━━━━━━━━━━╯

⏳ *Downloading audio...*`
        }, { quoted: msg });

        // Send audio
        await socket.sendMessage(sender, {
            audio: {
                url: song.downloadUrl
            },
            mimetype: 'audio/mpeg',
            fileName: `${song.title}.mp3`,
            ptt: false
        }, { quoted: msg });

    } catch (error) {
        console.error('PLAY ERROR:', error);

        await socket.sendMessage(sender, {
            text: `❌ *Play Error:*\n${error.message || 'Something went wrong.'}`
        }, { quoted: msg });
    }

    break;
}
// ========== PREMIUM TOOLS PACK - ALEXA-MIN ==========

case 'sticker':
case 's':
case 'stiker': {
try {
const q = args.join(' ').trim();

    const quotedMessage =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    const imageMessage =
        msg.message?.imageMessage || quotedMessage?.imageMessage;

    const videoMessage =
        msg.message?.videoMessage || quotedMessage?.videoMessage;

    const isImage = !!imageMessage;
    const isVideo = !!videoMessage;

    let mediaBuffer = null;

    if (isImage) {
        await socket.sendMessage(sender, {
            react: { text: '⏳', key: msg.key }
        });

        const { downloadMediaMessage } = require('@whiskeysockets/baileys');

        if (quotedMessage?.imageMessage) {
            mediaBuffer = await downloadMediaMessage(
                { message: quotedMessage },
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: socket.updateMediaMessage
                }
            );
        } else {
            mediaBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: socket.updateMediaMessage
                }
            );
        }

        if (!mediaBuffer) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to download image.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            sticker: mediaBuffer,
            packname: 'ALEXA-MIN',
            author: 'Watson'
        }, { quoted: msg });

    } else if (isVideo) {
        await socket.sendMessage(sender, {
            react: { text: '⏳', key: msg.key }
        });

        const { downloadMediaMessage } = require('@whiskeysockets/baileys');

        if (quotedMessage?.videoMessage) {
            mediaBuffer = await downloadMediaMessage(
                { message: quotedMessage },
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: socket.updateMediaMessage
                }
            );
        } else {
            mediaBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: socket.updateMediaMessage
                }
            );
        }

        if (!mediaBuffer) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to download video.'
            }, { quoted: msg });
        }

        // WhatsApp stickers have practical limits on animated sticker
        // duration/file size. Keep videos short for reliable conversion.
        const duration = videoMessage?.seconds || 0;

        if (duration > 8) {
            return await socket.sendMessage(sender, {
                text: '❌ Video is too long.\n\nPlease use a video shorter than 8 seconds.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            sticker: mediaBuffer,
            packname: 'ALEXA-MIN',
            author: 'Watson'
        }, { quoted: msg });

    } else if (
        q &&
        (q.startsWith('http://') || q.startsWith('https://'))
    ) {
        const axios = require('axios');

        const res = await axios.get(q, {
            responseType: 'arraybuffer',
            timeout: 15000
        });

        await socket.sendMessage(sender, {
            sticker: Buffer.from(res.data),
            packname: 'ALEXA-MIN',
            author: 'Watson'
        }, { quoted: msg });

    } else {
        return await socket.sendMessage(sender, {
            text:

`📌 Sticker Usage:

• Send an image with caption:
${config?.PREFIX || '.'}s

• Reply to an image/video with:
${config?.PREFIX || '.'}s

• Use an image URL:
${config?.PREFIX || '.'}s <image URL>

🎥 Video: Keep it shorter than 8 seconds.`
}, { quoted: msg });
}

    await socket.sendMessage(sender, {
        react: { text: '✅', key: msg.key }
    });

} catch (e) {
    console.error('Sticker error:', e);

    await socket.sendMessage(sender, {
        text: `❌ *Sticker Error:*\n${e.message || 'Something went wrong.'}`
    }, { quoted: msg });
}

break;

}

case 'toimg': case 'toimage': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted?.stickerMessage) return await socket.sendMessage(sender, { text: `📌 Reply to a sticker with ${config?.PREFIX||'.'}toimg` }, { quoted: msg });

        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {}, { logger: console, reuploadRequest: socket.updateMediaMessage });

        await socket.sendMessage(sender, { image: buffer, caption: "> Converted from sticker\n> ALEXA-MIN" }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ ToImg failed: ${e.message}` }, { quoted: msg }); }
    break;
}

case 'remini': case 'hd': case 'enhance': case 'upscale': {
    const axios = require('axios');
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const hasImage = msg.message?.imageMessage || quoted?.imageMessage;

        if (!hasImage) return await socket.sendMessage(sender, { text: `📌 Reply to blurry photo with ${config?.PREFIX||'.'}remini\n\nI will make it HD 4K!` }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });
        await socket.sendMessage(sender, { text: "✨ *Enhancing to HD...* wait 10s" }, { quoted: msg });

        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const msgToDl = quoted?.imageMessage? { message: quoted } : msg;
        const buffer = await downloadMediaMessage(msgToDl, 'buffer', {}, { logger: console, reuploadRequest: socket.updateMediaMessage });

        // Upload to catbox to get URL (needed for API)
        const FormData = require('form-data');
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', buffer, 'image.jpg');

        const uploadRes = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders(), timeout: 20000 });
        const imageUrl = uploadRes.data.trim();

        if (!imageUrl.includes('http')) throw new Error("Upload failed");

        // Remini APIs - 3 fallbacks
        let hdUrl = null;
        const apis = [
            `https://api.vreden.my.id/api/artificial/remini?url=${encodeURIComponent(imageUrl)}`,
            `https://api.davidcyriltech.my.id/remini?url=${encodeURIComponent(imageUrl)}`,
            `https://api.nexoracle.com/api/applications/remini?url=${encodeURIComponent(imageUrl)}`
        ];

        for (const api of apis) {
            try {
                const { data } = await axios.get(api, { timeout: 30000 });
                hdUrl = data.result || data.data?.url || data.url || data.image;
                if (hdUrl) break;
            } catch {}
        }

        if (!hdUrl) return await socket.sendMessage(sender, { text: "❌ HD failed. Try another photo." }, { quoted: msg });

        await socket.sendMessage(sender, {
            image: { url: hdUrl },
            caption: "✨ *ᕼᗪ EᑎᕼᗩᑎᑕEᗪ*\n> ᗩᒪE᙭ᗩ-ᗰIᑎ ᖇEᗰIᑎI"
        }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ Remini: ${e.message}` }, { quoted: msg }); }
    break;
}
case 'calc':
case 'calculate': {
    try {
        const expression = args.join(' ').trim();

        if (!expression) {
            return await socket.sendMessage(sender, {
                text: `📌 Usage: ${config?.PREFIX || '.'}calc 25 * 4`
            }, { quoted: msg });
        }

        // Only allow basic mathematical characters
        if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
            throw new Error('Only basic mathematical expressions are allowed.');
        }

        const result = Function(
            `"use strict"; return (${expression})`
        )();

        await socket.sendMessage(sender, {
            text:
`🧮 *CALCULATOR*

📌 Expression:
${expression}

✅ Result:
*${result}*`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Calculation error: ${e.message}`
        }, { quoted: msg });
    }
    break;
}
case 'uuid': {
    try {
        const { randomUUID } = require('crypto');

        await socket.sendMessage(sender, {
            text:
`🆔 *UUID GENERATOR*

\`${randomUUID()}\``
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ UUID error: ${e.message}`
        }, { quoted: msg });
    }
    break;
}
case 'password':
case 'passgen': {
    try {
        const crypto = require('crypto');

        const length =
            Math.min(
                Math.max(parseInt(args[0]) || 16, 8),
                64
            );

        const chars =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

        let password = '';

        for (let i = 0; i < length; i++) {
            password += chars[
                crypto.randomInt(chars.length)
            ];
        }

        await socket.sendMessage(sender, {
            text:
`🔐 *PASSWORD GENERATOR*

📏 Length: ${length}

\`${password}\`

⚠️ Keep your password private.`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Password error: ${e.message}`
        }, { quoted: msg });
    }
    break;
}
case 'base64':
case 'encode': {
    try {
        const text = args.join(' ');

        if (!text) {
            return await socket.sendMessage(sender, {
                text: `📌 Usage: ${config?.PREFIX || '.'}base64 hello world`
            }, { quoted: msg });
        }

        const encoded =
            Buffer.from(text, 'utf8').toString('base64');

        await socket.sendMessage(sender, {
            text:
`🔐 *BASE64 ENCODE*

Input:
${text}

Output:
\`${encoded}\``
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Encode error: ${e.message}`
        }, { quoted: msg });
    }
    break;
}
case 'decode': {
    try {
        const text = args.join(' ').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text: `📌 Usage: ${config?.PREFIX || '.'}decode SGVsbG8=`
            }, { quoted: msg });
        }

        const decoded =
            Buffer.from(text, 'base64').toString('utf8');

        await socket.sendMessage(sender, {
            text:
`🔓 *BASE64 DECODE*

Input:
\`${text}\`

Output:
${decoded}`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Decode error: ${e.message}`
        }, { quoted: msg });
    }
    break;
}
case 'joke': {
    try {
        const { data } = await axios.get(
            'https://official-joke-api.appspot.com/random_joke',
            { timeout: 10000 }
        );

        await socket.sendMessage(sender, {
            text:
`😂 *RANDOM JOKE*

${data.setup}

👉 ${data.punchline}

> ALEXA-MIN`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: '❌ Joke service unavailable.'
        }, { quoted: msg });
    }
    break;
}
case 'quote':
case 'quotes': {
    try {
        const { data } = await axios.get(
            'https://api.quotable.io/random',
            { timeout: 10000 }
        );

        await socket.sendMessage(sender, {
            text:
`💭 *RANDOM QUOTE*

"${data.content}"

— ${data.author}

> ALEXA-MIN`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: '❌ Quote service unavailable.'
        }, { quoted: msg });
    }
    break;
}
case 'fact': {
    try {
        const { data } = await axios.get(
            'https://uselessfacts.jsph.pl/api/v2/facts/random',
            { timeout: 10000 }
        );

        await socket.sendMessage(sender, {
            text:
`🧠 *RANDOM FACT*

${data.text}

> ALEXA-MIN`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: '❌ Fact service unavailable.'
        }, { quoted: msg });
    }
    break;
}
case '8ball': {
    const answers = [
        'Yes, definitely. 🎯',
        'Absolutely! ✅',
        'Most likely. 😎',
        'Ask again later. 🔮',
        'Probably not. 🤔',
        'No. ❌',
        'I doubt it. 😅',
        'The future is unclear. 🌌'
    ];

    const question = args.join(' ');

    if (!question) {
        return await socket.sendMessage(sender, {
            text: `🎱 Ask a question.\nExample: ${config?.PREFIX || '.'}8ball will I win?`
        }, { quoted: msg });
    }

    const answer =
        answers[Math.floor(Math.random() * answers.length)];

    await socket.sendMessage(sender, {
        text:
`🎱 *8 BALL*

❓ ${question}

🔮 *Answer:*
${answer}`
    }, { quoted: msg });

    break;
}
case 'wiki':
case 'wikipedia': {
    try {
        const query = args.join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: `📌 Usage: ${config?.PREFIX || '.'}wiki Albert Einstein`
            }, { quoted: msg });
        }

        const url =
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;

        const { data } =
            await axios.get(url, {
                timeout: 15000
            });

        await socket.sendMessage(sender, {
            text:
`📚 *WIKIPEDIA*

📌 *${data.title || query}*

${data.extract || 'No summary found.'}

🔗 ${data.content_urls?.desktop?.page || ''}`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Wikipedia error: ${e.message}`
        }, { quoted: msg });
    }

    break;
}
case 'define':
case 'meaning': {
    try {
        const word = args[0];

        if (!word) {
            return await socket.sendMessage(sender, {
                text: `📌 Usage: ${config?.PREFIX || '.'}define hello`
            }, { quoted: msg });
        }

        const { data } =
            await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                { timeout: 10000 }
            );

        const item = data[0];

        const meaning =
            item?.meanings?.[0];

        const definition =
            meaning?.definitions?.[0]?.definition ||
            'Definition unavailable.';

        await socket.sendMessage(sender, {
            text:
`📖 *DICTIONARY*

🔤 Word: *${word}*

📚 Type: ${meaning?.partOfSpeech || 'Unknown'}

📝 Definition:
${definition}`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Word not found: ${args.join(' ')}`
        }, { quoted: msg });
    }

    break;
}
case 'qr':
case 'qrcode': {
    try {
        const text = args.join(' ').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text:
`📌 *Usage:*
${config?.PREFIX || '.'}qr Hello World`
            }, { quoted: msg });
        }

        const url =
            `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(text)}`;

        await socket.sendMessage(sender, {
            image: { url },
            caption:
`📱 *QR CODE GENERATED*

📝 Data:
${text}

> ALEXA-MIN`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ QR error: ${e.message}`
        }, { quoted: msg });
    }

    break;
}
case 'shorturl':
case 'tinyurl': {
    try {
        const url = args.join(' ').trim();

        if (!/^https?:\/\//i.test(url)) {
            return await socket.sendMessage(sender, {
                text:
`📌 Usage:
${config?.PREFIX || '.'}shorturl https://example.com`
            }, { quoted: msg });
        }

        const api =
            `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`;

        const { data } =
            await axios.get(api, {
                timeout: 15000
            });

        await socket.sendMessage(sender, {
            text:
`🔗 *URL SHORTENER*

Original:
${url}

Short URL:
${data}`
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, {
            text: `❌ Short URL error: ${e.message}`
        }, { quoted: msg });
    }

    break;
}
case 'removebg': case 'nobg': {
    const axios = require('axios');
    const FormData = require('form-data');
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const hasImage = msg.message?.imageMessage || quoted?.imageMessage || quoted?.stickerMessage;
        if (!hasImage) return await socket.sendMessage(sender, { text: `📌 Reply to an image with ${config?.PREFIX||'.'}removebg` }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✂️', key: msg.key } });

        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const msgToDl = quoted ? { message: quoted } : msg;
        const buffer = await downloadMediaMessage(msgToDl, 'buffer', {}, { logger: console, reuploadRequest: socket.updateMediaMessage });

        // 1. Upload to catbox to get URL
        let imageUrl;
        try {
            const form = new FormData();
            form.append('reqtype', 'fileupload');
            form.append('fileToUpload', buffer, 'image.jpg');
            const up = await axios.post('https://catbox.moe/user/api.php', form, { 
                headers: form.getHeaders(), 
                timeout: 25000 
            });
            imageUrl = up.data.trim();
        } catch (e) {
            console.log("Catbox fail:", e.message);
        }

        if (!imageUrl) return await socket.sendMessage(sender, { text: "❌ Failed to upload image" }, { quoted: msg });

        // 2. Try multiple RemoveBG APIs (all free, no key)
        const apis = [
            `https://api.itsrose.life/image/removebg?url=${encodeURIComponent(imageUrl)}`,
            `https://api.davidcyriltech.my.id/removebg?url=${encodeURIComponent(imageUrl)}`,
            `https://api.bk9.fun/tools/removebg?url=${encodeURIComponent(imageUrl)}`,
            `https://api.nexoracle.com/api/tools/removebg?url=${encodeURIComponent(imageUrl)}`,
            `https://api.siputzx.my.id/api/m/removebg?url=${encodeURIComponent(imageUrl)}`
        ];

        let bgUrl = null;
        let resultBuffer = null;

        for (const api of apis) {
            try {
                const { data } = await axios.get(api, { timeout: 30000 });
                // APIs return different formats
                const res = data.result || data.url || data.data?.url || data.data?.result || data.image || data;
                
                if (typeof res === 'string' && res.startsWith('http')) {
                    bgUrl = res;
                    break;
                }
                // some return base64
                if (res && res.base64) {
                    resultBuffer = Buffer.from(res.base64, 'base64');
                    break;
                }
            } catch (err) {
                console.log(`BG API fail ${api}:`, err.message);
                continue;
            }
        }

        if (!bgUrl && !resultBuffer) {
            return await socket.sendMessage(sender, { text: "❌ All RemoveBG servers are down. Try again later." }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        if (resultBuffer) {
            await socket.sendMessage(sender, {
                image: resultBuffer,
                caption: "✂️ *Background Removed*\n> ALEXA-MIN"
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                image: { url: bgUrl },
                caption: "✂️ *Background Removed*\n> ALEXA-MIN"
            }, { quoted: msg });
        }

    } catch (e) {
        console.error("removebg error:", e);
        await socket.sendMessage(sender, { text: `❌ BG Error: ${e.message.slice(0,100)}` }, { quoted: msg });
    }
    break;
}
case 'googleimg':
case 'image':
case 'gis': {
    const axios = require('axios');

    try {
        if (!args.length) {
            return await socket.sendMessage(sender, {
                text:
`📌 *Usage:*
${config?.PREFIX || '.'}googleimg <search query>

🖼️ *Example:*
${config?.PREFIX || '.'}googleimg dog`
            }, { quoted: msg });
        }

        const query = args.join(' ').trim();

        await socket.sendMessage(sender, {
            react: {
                text: '🔎',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `🔎 *Searching Google Images for:* ${query}`
        }, { quoted: msg });

        const apiUrl =
            `https://api.siputzx.my.id/api/s/googleimg?query=${encodeURIComponent(query)}`;

        const response = await axios.get(apiUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const data = response.data;

        console.log(
            'GOOGLEIMG RESPONSE:',
            JSON.stringify(data, null, 2)
        );

        if (
            !data ||
            !Array.isArray(data.data) ||
            data.data.length === 0
        ) {
            return await socket.sendMessage(sender, {
                text: `❌ *No images found for:* ${query}`
            }, { quoted: msg });
        }

        const results = data.data;
        const maxResults = Math.min(results.length, 5);

        let sentCount = 0;

        for (let i = 0; i < maxResults; i++) {
            const item = results[i];

            const imageUrl =
                typeof item === 'string'
                    ? item
                    : item?.url ||
                      item?.image ||
                      item?.imageUrl ||
                      item?.thumbnail ||
                      item?.src;

            if (
                !imageUrl ||
                !/^https?:\/\//i.test(imageUrl)
            ) {
                continue;
            }

            try {
                await socket.sendMessage(sender, {
                    image: {
                        url: imageUrl
                    },
                    caption:
`🖼️ *GOOGLE IMAGE SEARCH*

🔎 *Query:* ${query}
📸 *Result:* ${i + 1}/${maxResults}

> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`
                }, { quoted: msg });

                sentCount++;

            } catch (imageError) {
                console.log(
                    `Google image ${i + 1} failed:`,
                    imageError.message
                );
            }
        }

        if (sentCount === 0) {
            return await socket.sendMessage(sender, {
                text:
                    '❌ Found results, but none of the images could be sent.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (e) {
        console.error(
            'GOOGLEIMG ERROR:',
            e.response?.data || e.message
        );

        await socket.sendMessage(sender, {
            text:
`❌ *Google Image Error:*

${e.message || 'Something went wrong.'}`
        }, { quoted: msg });
    }

    break;
}
case 'pinterest':
case 'pin':
case 'pinterestimg': {
    const axios = require('axios');

    try {
        if (!args.length) {
            return await socket.sendMessage(sender, {
                text:
`📌 *Usage:*
${config?.PREFIX || '.'}pinterest <search query>

📸 *Example:*
${config?.PREFIX || '.'}pinterest cat`
            }, { quoted: msg });
        }

        const query = args.join(' ').trim();

        await socket.sendMessage(sender, {
            react: {
                text: '📌',
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `📌 *Searching Pinterest for:* ${query}`
        }, { quoted: msg });

        const apiUrl =
            `https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(query)}&type=image`;

        const response = await axios.get(apiUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        console.log(
            'PINTEREST RESPONSE:',
            JSON.stringify(response.data, null, 2)
        );

        const data = response.data;

        if (
            !data ||
            !Array.isArray(data.data) ||
            data.data.length === 0
        ) {
            return await socket.sendMessage(sender, {
                text:
                    `❌ *No Pinterest images found for:* ${query}`
            }, { quoted: msg });
        }

        const results = data.data;
        const maxResults = Math.min(results.length, 5);

        let sent = 0;

        for (let i = 0; i < maxResults; i++) {
            const item = results[i];

            const imageUrl =
                typeof item === 'string'
                    ? item
                    : item?.url ||
                      item?.image ||
                      item?.imageUrl ||
                      item?.download ||
                      item?.src ||
                      item?.thumbnail;

            if (
                !imageUrl ||
                !/^https?:\/\//i.test(imageUrl)
            ) {
                continue;
            }

            try {
                await socket.sendMessage(sender, {
                    image: {
                        url: imageUrl
                    },
                    caption:
`📌 *PINTEREST SEARCH*

🔎 *Query:* ${query}
📸 *Result:* ${sent + 1}/${maxResults}

> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`
                }, { quoted: msg });

                sent++;

            } catch (err) {
                console.log(
                    `Pinterest image ${i + 1} failed:`,
                    err.message
                );
            }
        }

        if (sent === 0) {
            return await socket.sendMessage(sender, {
                text:
                    '❌ Pinterest returned results, but I could not send any images.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (e) {
        console.error(
            'PINTEREST ERROR:',
            e.response?.data || e.message
        );

        await socket.sendMessage(sender, {
            text:
`❌ *Pinterest Error:*

${e.message || 'Something went wrong.'}`
        }, { quoted: msg });
    }

    break;
}
case 'blur':
case 'imageblur': {
const axios = require('axios');
const FormData = require('form-data');

try {
    const q = args.join(' ').trim();

    const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    const imageMessage =
        msg.message?.imageMessage || quoted?.imageMessage;

    let imageUrl = null;

    // Direct image URL
    if (q && /^https?:\/\//i.test(q)) {
        imageUrl = q;
    }

    // Replied/sent image
    else if (imageMessage) {
        await socket.sendMessage(sender, {
            react: { text: '🌫️', key: msg.key }
        });

        const {
            downloadMediaMessage
        } = require('@whiskeysockets/baileys');

        const msgToDownload = quoted?.imageMessage
            ? { message: quoted }
            : msg;

        const buffer = await downloadMediaMessage(
            msgToDownload,
            'buffer',
            {},
            {
                logger: console,
                reuploadRequest: socket.updateMediaMessage
            }
        );

        if (!buffer || !buffer.length) {
            throw new Error('Failed to download image.');
        }

        // Upload to Catbox
        const form = new FormData();

        form.append('reqtype', 'fileupload');
        form.append(
            'fileToUpload',
            buffer,
            {
                filename: 'blur.jpg',
                contentType: imageMessage.mimetype || 'image/jpeg'
            }
        );

        const upload = await axios.post(
            'https://catbox.moe/user/api.php',
            form,
            {
                headers: form.getHeaders(),
                timeout: 30000
            }
        );

        imageUrl = String(upload.data || '').trim();

        if (!imageUrl.startsWith('http')) {
            throw new Error('Failed to upload image.');
        }
    }

    if (!imageUrl) {
        return await socket.sendMessage(sender, {
            text:

`📌 Blur Usage:

• Reply to an image with:
${config?.PREFIX || '.'}blur

• Or use an image URL:
${config?.PREFIX || '.'}blur https://example.com/image.jpg`
}, { quoted: msg });
}

    await socket.sendMessage(sender, {
        react: { text: '🌫️', key: msg.key }
    });

    await socket.sendMessage(sender, {
        text: '🌫️ *Blurring image...*'
    }, { quoted: msg });

    const apiUrl =
        `https://api.siputzx.my.id/api/canvas/blur?image=${encodeURIComponent(imageUrl)}`;

    const response = await axios.get(apiUrl, {
        timeout: 60000,
        responseType: 'arraybuffer'
    });

    const contentType =
        response.headers['content-type'] || '';

    if (!contentType.includes('image')) {
        throw new Error('Blur API did not return an image.');
    }

    const resultBuffer = Buffer.from(response.data);

    await socket.sendMessage(sender, {
        image: resultBuffer,
        caption:

`🌫️ IMAGE BLURRED

╭━━━〔 🌫️ BLUR 〕━━━╮
┃
┃ 🖼️ Image processed
┃ 🤖 Alexa-Min
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
}, { quoted: msg });

    await socket.sendMessage(sender, {
        react: { text: '✅', key: msg.key }
    });

} catch (e) {
    console.error(
        'BLUR ERROR:',
        e.response?.data || e.message
    );

    await socket.sendMessage(sender, {
        text:

`❌ Blur Error:

${e.message || 'Something went wrong.'}`
}, { quoted: msg });
}

break;

}
case 'affect':
case 'affectimage': {
const axios = require('axios');
const FormData = require('form-data');

try {
    const q = args.join(' ').trim();

    const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    const imageMessage =
        msg.message?.imageMessage || quoted?.imageMessage;

    let imageUrl = null;

    // Direct image URL
    if (q && /^https?:\/\//i.test(q)) {
        imageUrl = q;
    }

    // Replied/sent image
    else if (imageMessage) {
        await socket.sendMessage(sender, {
            react: { text: '🎨', key: msg.key }
        });

        const {
            downloadMediaMessage
        } = require('@whiskeysockets/baileys');

        const msgToDownload = quoted?.imageMessage
            ? { message: quoted }
            : msg;

        const buffer = await downloadMediaMessage(
            msgToDownload,
            'buffer',
            {},
            {
                logger: console,
                reuploadRequest: socket.updateMediaMessage
            }
        );

        if (!buffer || !buffer.length) {
            throw new Error('Failed to download image.');
        }

        // Upload image to Catbox
        const form = new FormData();

        form.append(
            'reqtype',
            'fileupload'
        );

        form.append(
            'fileToUpload',
            buffer,
            {
                filename: 'affect.jpg',
                contentType: imageMessage.mimetype || 'image/jpeg'
            }
        );

        const upload = await axios.post(
            'https://catbox.moe/user/api.php',
            form,
            {
                headers: form.getHeaders(),
                timeout: 30000
            }
        );

        imageUrl = String(upload.data || '').trim();

        if (!imageUrl.startsWith('http')) {
            throw new Error('Failed to upload image.');
        }
    }

    if (!imageUrl) {
        return await socket.sendMessage(sender, {
            text:

`📌 Affect Usage:

• Reply to an image with:
${config?.PREFIX || '.'}affect

• Or use an image URL:
${config?.PREFIX || '.'}affect https://example.com/image.jpg`
}, { quoted: msg });
}

    await socket.sendMessage(sender, {
        react: { text: '🎨', key: msg.key }
    });

    await socket.sendMessage(sender, {
        text: '🎨 *Applying affect...*'
    }, { quoted: msg });

    const apiUrl =
        `https://api.siputzx.my.id/api/canvas/affect?image=${encodeURIComponent(imageUrl)}`;

    const response = await axios.get(apiUrl, {
        timeout: 60000,
        responseType: 'arraybuffer'
    });

    const contentType =
        response.headers['content-type'] || '';

    if (!contentType.includes('image')) {
        throw new Error('Affect API did not return an image.');
    }

    const resultBuffer = Buffer.from(response.data);

    await socket.sendMessage(sender, {
        image: resultBuffer,
        caption:

`🎨 AFFECT APPLIED

╭━━━〔 🎨 AFFECT 〕━━━╮
┃
┃ 🖼️ Image processed
┃ 🤖 Alexa-Min
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
}, { quoted: msg });

    await socket.sendMessage(sender, {
        react: { text: '✅', key: msg.key }
    });

} catch (e) {
    console.error(
        'AFFECT ERROR:',
        e.response?.data || e.message
    );

    await socket.sendMessage(sender, {
        text:

`❌ Affect Error:

${e.message || 'Something went wrong.'}`
}, { quoted: msg });
}

break;

}
case 'mod':
case 'mode': {
    const fs = require('fs-extra');
    const path = require('path');
    try {
        const ownerCheck = typeof isOwner!== 'undefined'? isOwner : (sender.split('@')[0] === (config?.OWNER_NUMBER || '263').replace(/[^0-9]/g,'').slice(0,12));

        if (!ownerCheck) {
            return await socket.sendMessage(sender, { text: "*📛 This is an owner command.*" }, { quoted: msg });
        }

        const senderNum = sender.split('@')[0].replace(/[^0-9]/g,'');
        let currentConfig = typeof userConfig!== 'undefined'? userConfig : config;
        let currentMode = currentConfig?.MODE || config?.MODE || 'public';
        let prefix = currentConfig?.PREFIX || config?.PREFIX || '.';

        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: `📌 *Usage:* ${prefix}mode <option>\n\n*Current:* ${currentMode}\n\n*Options:*\n1. *public* - Everyone can use bot\n2. *private* - Only owner can use\n3. *inbox* - Only work in DM\n4. *groups* - Only work in groups\n\n*Example:* ${prefix}mode private`
            }, { quoted: msg });
        }

        const mode = args[0].toLowerCase();
        const allowed = ['public', 'private', 'inbox', 'groups', 'group'];

        if (!allowed.includes(mode)) {
            return await socket.sendMessage(sender, {
                text: `❌ *Invalid mode!*\n\n*Available:*\n• public\n• private\n• inbox\n• groups`
            }, { quoted: msg });
        }

        // Normalize groups -> group
        let finalMode = mode === 'groups'? 'groups' : mode;

        // Save
        try {
            if (typeof updateUserConfig === 'function') {
                currentConfig.MODE = finalMode;
                const sanitized = typeof sanitizedNumber!== 'undefined'? sanitizedNumber : senderNum;
                await updateUserConfig(sanitized, currentConfig);
            } else {
                // Fallback save
                if (config) config.MODE = finalMode;
                const configPath = path.join(__dirname, '../config.json');
                if (fs.existsSync(configPath)) {
                    const cfg = fs.readJsonSync(configPath);
                    cfg.MODE = finalMode;
                    fs.writeJsonSync(configPath, cfg, { spaces: 2 });
                }
            }
        } catch (e) {
            console.log("Mode save error:", e.message);
        }

        // Apply instantly
        if (typeof global!== 'undefined') global.mode = finalMode;
        if (config) config.MODE = finalMode;
        if (typeof userConfig!== 'undefined') userConfig.MODE = finalMode;

        const desc = {
            public: 'Everyone can use bot in DM & Groups',
            private: 'Only YOU (owner) can use commands',
            inbox: 'Bot works only in private chat (DM)',
            groups: 'Bot works only in groups',
            group: 'Bot works only in groups'
        };

        await socket.sendMessage(sender, {
            text: `✅ *Mode changed!*\n\n*From:* ${currentMode}\n*To:* ${finalMode}\n\n📝 *Info:* ${desc[finalMode]}\n\n> Change applied instantly.`
        }, { quoted: msg });

    } catch (err) {
        console.error("Mode error:", err);
        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }
    break;
}
case 'prefix': {
    const fs = require('fs-extra');
    const path = require('path');
    try {
        // Check owner - support both methods
        const ownerCheck = typeof isOwner!== 'undefined'? isOwner : (sender.split('@')[0] === (config?.OWNER_NUMBER || '263').replace(/[^0-9]/g,''));

        if (!ownerCheck) {
            return await socket.sendMessage(sender, { text: "*📛 This is an owner command.*" }, { quoted: msg });
        }

        // Load config safely
        const senderNum = sender.split('@')[0].replace(/[^0-9]/g,'');
        const sanitizedNumber = typeof sanitizedNumber!== 'undefined'? sanitizedNumber : senderNum;

        let userConfig = typeof userConfig!== 'undefined'? userConfig : config;
        let currentPrefix = userConfig?.PREFIX || config?.PREFIX || '.';

        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: `📌 *Usage:* ${currentPrefix}prefix <new_prefix>\n\n*Current:* ${currentPrefix}\n\n*Examples:*\n${currentPrefix}prefix.\n${currentPrefix}prefix!\n${currentPrefix}prefix $\n${currentPrefix}prefix reset (to get back.)`
            }, { quoted: msg });
        }

        let newPrefix = args[0].trim();

        // Allow reset
        if (newPrefix.toLowerCase() === 'reset' || newPrefix.toLowerCase() === 'default') {
            newPrefix = '.';
        }

        // Validation - block dangerous prefixes
        const blocked = ['*', '/', '\\', '`', '"', "'", ' ', '\n', 'http', 'www'];
        if (blocked.includes(newPrefix) || newPrefix.length > 2) {
            return await socket.sendMessage(sender, {
                text: `❌ *Invalid prefix!*\n\nAllowed:.! # $ % & + - = ~?\nMax: 2 chars\nDon't use: * / \\ or letters`
            }, { quoted: msg });
        }

        // Must be symbol, not letter/number
        if (/^[a-zA-Z0-9]$/.test(newPrefix)) {
            return await socket.sendMessage(sender, {
                text: `❌ *Don't use letters/numbers as prefix.*\nUse symbols like.! # $`
            }, { quoted: msg });
        }

        // Save
        try {
            if (typeof updateUserConfig === 'function') {
                userConfig.PREFIX = newPrefix;
                await updateUserConfig(sanitizedNumber, userConfig);
            } else {
                // Fallback: save to config.json
                if (config) config.PREFIX = newPrefix;
                const configPath = path.join(__dirname, '../config.json');
                if (fs.existsSync(configPath)) {
                    const cfg = fs.readJsonSync(configPath);
                    cfg.PREFIX = newPrefix;
                    fs.writeJsonSync(configPath, cfg, { spaces: 2 });
                }
            }
        } catch (e) {
            console.log("Config save error:", e.message);
        }

        // Update global
        if (typeof global!== 'undefined') global.prefix = newPrefix;
        if (config) config.PREFIX = newPrefix;

        await socket.sendMessage(sender, {
            text: `✅ *Prefix changed!*\n\n*Old:* ${currentPrefix}\n*New:* ${newPrefix}\n\n*Try:* ${newPrefix}menu\n*Try:* ${newPrefix}ping\n\nBot will restart to apply fully.`
        }, { quoted: msg });

    } catch (err) {
        console.error("Prefix error:", err);
        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }
    break;
}
case 'uptime':
case 'runtime':
case 'alive': {
const os = require('os');

try {
    // Spam protection
    const senderNum = sender
        .split('@')[0]
        .replace(/[^0-9]/g, '');

    socket.lastAliveCall = socket.lastAliveCall || new Map();

    const lastCall =
        socket.lastAliveCall.get(senderNum) || 0;

    if (Date.now() - lastCall < 5000) {
        return await socket.sendMessage(
            sender,
            {
                text: '⏳ Wait 5s before checking again.'
            },
            { quoted: msg }
        );
    }

    socket.lastAliveCall.set(senderNum, Date.now());

    // ─────────────────────────────
    // REAL BOT RUNTIME
    // ─────────────────────────────

    const uptimeSec = Math.floor(process.uptime());

    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;

    let runtime = '';

    if (days > 0) {
        runtime += `${days}d `;
    }

    runtime += `${hours}h ${minutes}m ${seconds}s`;

    // ─────────────────────────────
    // MEMORY
    // ─────────────────────────────

    const totalMem =
        os.totalmem() / (1024 ** 3);

    const freeMem =
        os.freemem() / (1024 ** 3);

    const usedMem =
        totalMem - freeMem;

    const memPercent =
        ((usedMem / totalMem) * 100).toFixed(0);

    const health =
        memPercent < 80
            ? '🟢 Excellent'
            : memPercent < 90
                ? '🟡 Good'
                : '🔴 High';

    // ─────────────────────────────
    // CPU
    // ─────────────────────────────

    const cpuLoad =
        os.loadavg()[0].toFixed(2);

    const cpuCores =
        os.cpus().length;

    const botImage =
        config?.IK_IMAGE_PATH ||
        config?.IMAGE_PATH ||
        'https://files.catbox.moe/2q6j6k.jpg';

    const prefix =
        config?.PREFIX || '.';

    const mode =
        config?.MODE || 'Public';

    const date =
        new Date().toLocaleString(
            'en-ZA',
            {
                timeZone: 'Africa/Harare'
            }
        );

    // ─────────────────────────────
    // STATUS MESSAGE
    // ─────────────────────────────

    const aliveText = `

✨ ᴀʟᴇxᴀ-ᴍɪɴ - ꜱʏꜱᴛᴇᴍ ꜱᴛᴀᴛᴜꜱ ✨

╭───❖ BOT INFO ❖───
│ 👑 Owner: Watson Fourpence
│ 🤖 Name: Alexa-Mini V2
│ 🔖 Version: 3.0.0 Stable
│ 🌍 Mode: ${mode}
│ 🔑 Prefix: ${prefix}
│ 📚 Lib: Baileys MD
│ 🟢 Status: Online
╰───────────────❖

╭───❖ SERVER STATS ❖───
│ ⏰ Runtime: ${runtime}
│ 💾 RAM: ${usedMem.toFixed(2)}GB / ${totalMem.toFixed(2)}GB (${memPercent}%)
│ ⚙️ CPU: ${cpuLoad} | Cores: ${cpuCores}
│ 🩺 Health: ${health}
│ 🖥️ Host: ${os.hostname()}
│ 📅 Date: ${date}
╰───────────────❖

Commands: ${prefix}menu | ${prefix}ping

«© ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ
`.trim();

    // ─────────────────────────────
    // SEND STATUS
    // ─────────────────────────────

    await socket.sendMessage(
        sender,
        {
            image: {
                url: botImage
            },
            caption: aliveText,

            contextInfo: {
                mentionedJid: [sender],

                forwardingScore: 999,
                isForwarded: true,

                forwardedNewsletterMessageInfo: {
                    newsletterJid:
                        '1203634182592851@newsletter',

                    newsletterName:
                        '⚡ ᗩᒪE᙭ᗩ-ᗰIᑎ ⚡',

                    serverMessageId: 143
                },

                externalAdReply: {
                    title:
                        `Runtime: ${runtime}`,

                    body:
                        `RAM: ${usedMem.toFixed(2)}GB | ${health}`,

                    thumbnailUrl:
                        botImage,

                    sourceUrl:
                        'https://chat.whatsapp.com/FK2HSe9McfzD8QAFKyLA1W',

                    mediaType: 1,

                    renderLargerThumbnail:
                        true
                }
            }
        },
        { quoted: msg }
    );

} catch (error) {
    console.error(
        'ALIVE ERROR:',
        error
    );

    await socket.sendMessage(
        sender,
        {
            text:
                `⚠️ *Status Error:*\n${error.message || 'Unable to check status.'}`
        },
        { quoted: msg }
    );
}

break;

}
case 'user':
case 'now':
case 'sigma':
case 'dj':
case 'active': {
    const activeSessionsText = `> *Tᴏᴛᴀʟ Aᴄᴛɪᴠᴇ Usᴇʀs:* ${activeSockets.size} ✅`;
    await socket.sendMessage(sender, { text: activeSessionsText }, { quoted: msg });
    break;
}
case 'menu': {
    try {

        // ─────────────────────────────
        // GET CATEGORY FIRST
        // ─────────────────────────────

        const category =
            String(args?.[0] || '')
                .toLowerCase()
                .trim();


        // ─────────────────────────────
        // MENU SPAM PROTECTION
        // ONLY PROTECT FULL MENU
        //
        // Category buttons such as:
        // .menu download
        // .menu ai
        // .menu tools
        //
        // are NOT blocked.
        // ─────────────────────────────

        socket.lastMenuCall =
            socket.lastMenuCall || new Map();

        const menuUser =
            sender?.split('@')[0] || sender;

        const lastMenuCall =
            socket.lastMenuCall.get(menuUser) || 0;

        if (
            !category &&
            Date.now() - lastMenuCall < 5000
        ) {

            return await socket.sendMessage(
                sender,
                {
                    text:
                        '⏳ Please wait 5 seconds before opening the main menu again.'
                },
                { quoted: msg }
            );
        }

        // Only save timestamp for main menu
        if (!category) {
            socket.lastMenuCall.set(
                menuUser,
                Date.now()
            );
        }


        // ─────────────────────────────
        // GET USER NAME
        // ─────────────────────────────

        let userName =
            msg?.pushName ||
            msg?.notifyName ||
            msg?.name ||
            'there';

        userName =
            String(userName)
                .trim()
                .replace(/\s+/g, ' ');

        if (
            !userName ||
            userName.length > 40
        ) {
            userName = 'there';
        }


        // ─────────────────────────────
        // TIME GREETING
        // ─────────────────────────────

        const dateObject =
            new Date();

        const hour =
            Number(
                new Intl.DateTimeFormat(
                    'en-ZA',
                    {
                        timeZone:
                            'Africa/Harare',
                        hour:
                            '2-digit',
                        hour12:
                            false
                    }
                ).format(dateObject)
            );

        let greeting;

        if (
            hour >= 5 &&
            hour < 12
        ) {

            greeting =
                'Good morning';

        } else if (
            hour >= 12 &&
            hour < 18
        ) {

            greeting =
                'Good afternoon';

        } else {

            greeting =
                'Good evening';
        }


        // ─────────────────────────────
        // BOT RUNTIME
        // ─────────────────────────────

        const uptimeSec =
            Math.floor(
                process.uptime()
            );

        const days =
            Math.floor(
                uptimeSec / 86400
            );

        const hours =
            Math.floor(
                (uptimeSec % 86400) /
                3600
            );

        const minutes =
            Math.floor(
                (uptimeSec % 3600) /
                60
            );

        const seconds =
            uptimeSec % 60;

        const runtime =
            days > 0
                ? `${days}d ${hours}h ${minutes}m ${seconds}s`
                : `${hours}h ${minutes}m ${seconds}s`;


        // ─────────────────────────────
        // DATE
        // ─────────────────────────────

        const now =
            dateObject.toLocaleString(
                'en-ZA',
                {
                    timeZone:
                        'Africa/Harare',

                    weekday:
                        'short',

                    day:
                        'numeric',

                    month:
                        'short',

                    year:
                        'numeric',

                    hour:
                        '2-digit',

                    minute:
                        '2-digit',

                    second:
                        '2-digit'
                }
            );


        // ─────────────────────────────
        // CONFIG
        // ─────────────────────────────

        const p =
            config?.PREFIX ||
            '.';

        const botName =
            config?.BOT_NAME ||
            'ALEXA-MINI';

        const version =
            config?.VERSION ||
            '3.0.0 Stable';

        const owner =
            config?.OWNER_NAME ||
            'Watson Fourpence';


        // ─────────────────────────────
        // MENU COMMANDS
        // ─────────────────────────────

        const menuSections = {

            main: [
                ['alive', 'System status'],
                ['uptime', 'Bot runtime'],
                ['menu', 'Show menu'],
                ['ping', 'Check latency'],
                ['system', 'System information'],
                ['owner', 'Owner contact'],
                ['jid', 'Get JID'],
                ['sc', 'Source code'],
                ['stats', 'Usage statistics']
            ],

            download: [
                ['play', 'YouTube audio'],
                ['video', 'Video download'],
                ['fb', 'Facebook video'],
                ['tt', 'TikTok download'],
                ['ig', 'Instagram media'],
                ['apk', 'APK downloader'],
                ['yts', 'YouTube search'],
                ['artist', 'Artist information'],
                ['insta-story', 'Instagram story']
            ],

            ai: [
                ['ai', 'AI chat'],
                ['gpt', 'ChatGPT'],
                ['chatgpt', 'ChatGPT'],
                ['dj', 'AI DJ'],
                ['imagine', 'AI image'],
                ['flux', 'Flux AI'],
                ['translate', 'Translator'],
                ['voice', 'Text to speech']
            ],

            image: [
                ['googleimg', 'Google image search'],
                ['gimage', 'Google image search'],
                ['gis', 'Google image search'],
                ['pinterest', 'Pinterest images'],
                ['pin', 'Pinterest images'],
                ['pinterestimg', 'Pinterest images'],
                ['blur', 'Blur image'],
                ['affect', 'Affect image'],
                ['removebg', 'Remove background'],
                ['nobg', 'Remove background'],
                ['remini', 'HD enhance']
            ],

            effects: [
                ['photooxy', 'Photooxy effects'],
                ['photoox', 'Photooxy effects'],
                ['skytext', 'Sky text effect'],
                ['shadowtext', 'Shadow text effect']
            ],

            tools: [
                ['sticker', 'Make sticker'],
                ['s', 'Make sticker'],
                ['stiker', 'Make sticker'],
                ['take', 'Rename sticker'],
                ['qr', 'Generate QR'],
                ['shorturl', 'Shorten URL'],
                ['weather', 'Weather'],
                ['calculate', 'Calculator'],
                ['calc', 'Calculator'],
                ['uuid', 'Generate UUID'],
                ['password', 'Generate secure password'],
                ['base64encode', 'Base64 encode'],
                ['base64decode', 'Base64 decode'],
                ['joke', 'Random joke'],
                ['quote', 'Random quote'],
                ['fact', 'Random fact'],
                ['8ball', 'Magic 8-Ball'],
                ['wikipedia', 'Wikipedia search'],
                ['wiki', 'Wikipedia search'],
                ['define', 'Dictionary definition'],
                ['github', 'GitHub downloader'],
                ['git', 'GitHub downloader'],
                ['gist', 'GitHub Gist'],
                ['fetch', 'Fetch URL/API']
            ],

            group: [
                ['promote', 'Promote admin'],
                ['demote', 'Demote admin'],
                ['add', 'Add member'],
                ['kick', 'Remove member'],
                ['mute', 'Mute group'],
                ['unmute', 'Unmute group'],
                ['tagall', 'Tag everyone'],
                ['groupinfo', 'Group information'],
                ['poll', 'Create poll']
            ],

            owner: [
                ['pair', 'Connect bot'],
                ['getpp', 'Get profile picture'],
                ['join', 'Join group'],
                ['save', 'Save status'],
                ['broadcast', 'Broadcast message'],
                ['restart', 'Restart bot']
            ]
        };


        // ─────────────────────────────
        // CATEGORY ICONS
        // ─────────────────────────────

        const icons = {

            main:
                '🤖',

            download:
                '📥',

            ai:
                '✨',

            image:
                '🖼️',

            effects:
                '🎨',

            tools:
                '🛠️',

            group:
                '👥',

            owner:
                '👑'
        };


        // ─────────────────────────────
        // VALID CATEGORY
        // ─────────────────────────────

        const validCategory =
            category &&
            Object.prototype.hasOwnProperty.call(
                menuSections,
                category
            );


        // ─────────────────────────────
        // FORMAT CATEGORY
        // ─────────────────────────────

        const formatSection =
            (key) => {

                let text =
                    `*${icons[key]} ${key.toUpperCase()}*\n`;

                for (
                    const [cmd, desc]
                    of menuSections[key]
                ) {

                    text +=
                        `│ ◦ ${p}${cmd} — ${desc}\n`;
                }

                return text;
            };


        // ─────────────────────────────
        // TOTAL COMMANDS
        // ─────────────────────────────

        const total =
            Object.values(
                menuSections
            ).reduce(
                (sum, section) =>
                    sum + section.length,
                0
            );


        // ─────────────────────────────
        // BUILD CAPTION
        // ─────────────────────────────

        let caption;


        // ─────────────────────────────
        // CATEGORY MENU
        // ─────────────────────────────

        if (validCategory) {

            const section =
                menuSections[category];

            caption =
`╭───❖ ${botName} ❖───
│ 👋 ${greeting}, ${userName}!
│ 📂 Category: ${category.toUpperCase()}
│ 📚 Commands: ${section.length}
│ ⏰ Runtime: ${runtime}
╰───────────────❖

${formatSection(category)}

╭───────────────❖
│ 📋 Tap *All Menu* to return
╰───────────────❖`;

        }


        // ─────────────────────────────
        // MAIN MENU
        //
        // IMPORTANT:
        // NO COMMANDS ARE DISPLAYED HERE.
        // ─────────────────────────────

        else {

            caption =
`✨ ᴀʟᴇxᴀ-ᴍɪɴ - ᴍᴀɪɴ ᴍᴇɴᴜ ✨

╭───❖ WELCOME ❖───
│ 👋 ${greeting}, ${userName}!
│ 🤖 Welcome to ${botName}
│ 💬 Your personal WhatsApp assistant
╰───────────────❖

╭───❖ BOT INFO ❖───
│ 👑 Owner: ${owner}
│ 🤖 Name: ${botName}
│ 🔖 Version: ${version}
│ 🌍 Mode: ${config?.MODE || 'Public'}
│ 🔑 Prefix: ${p}
│ 📚 Lib: Baileys MD
│ 🟢 Status: Online
╰───────────────❖

╭───❖ SYSTEM ❖───
│ ⏰ Runtime: ${runtime}
│ 📅 Date: ${now}
│ 📚 Commands: ${total}
╰───────────────❖

╭───❖ MENU ❖───
│ 📋 Choose a category
│ 👇 Tap a button below
│ 💬 Commands will appear
│    after you choose a category
╰───────────────❖`;
        }


        // ─────────────────────────────
        // VOICE SCRIPT
        // ─────────────────────────────

        let voiceText;


        if (validCategory) {

            voiceText =
`${greeting}, ${userName}.
You are now viewing the ${category} menu.
There are ${menuSections[category].length} commands available.
Choose a command from the menu.
I'm ${botName}, and I'm ready to help you.`;

        } else {

            // SHORT VOICE MESSAGE
            // This is more reliable with Google TTS.

            voiceText =
`${greeting}, ${userName}.
Welcome to ${botName}.
Your menu is ready.
Please choose a category below to see my commands.
I'm ready to help you.`;
        }


        // ─────────────────────────────
        // GENERATE TTS
        // ─────────────────────────────

        let audioBuffer =
            null;

        try {

            if (
                typeof generateTTS ===
                'function'
            ) {

                audioBuffer =
                    await generateTTS(
                        voiceText
                    );

            } else {

                console.error(
                    'generateTTS function is not available.'
                );
            }

        } catch (ttsError) {

            console.error(
                'MENU TTS ERROR:',
                ttsError
            );

            audioBuffer =
                null;
        }


        // ─────────────────────────────
        // SEND VOICE
        // ─────────────────────────────

        if (audioBuffer) {

            try {

                await socket.sendMessage(
                    sender,
                    {
                        audio:
                            audioBuffer,

                        mimetype:
                            'audio/mpeg',

                        ptt:
                            false
                    },
                    {
                        quoted:
                            msg
                    }
                );

                console.log(
                    `Menu TTS sent to ${userName}`
                );

            } catch (voiceSendError) {

                console.error(
                    'VOICE SEND ERROR:',
                    voiceSendError
                );
            }
        }


        // ─────────────────────────────
        // CATEGORY BUTTONS
        // ─────────────────────────────

        let buttons;


        // CATEGORY PAGE
        // ONLY SHOW ALL MENU

        if (validCategory) {

            buttons = [

                {
                    buttonId:
                        `${p}menu`,

                    buttonText: {
                        displayText:
                            '📋 All Menu'
                    },

                    type:
                        1
                }

            ];

        }


        // MAIN PAGE
        // SHOW CATEGORIES ONLY

        else {

            buttons = [

                {
                    buttonId:
                        `${p}menu main`,

                    buttonText: {
                        displayText:
                            '🤖 Main'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu download`,

                    buttonText: {
                        displayText:
                            '📥 Download'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu ai`,

                    buttonText: {
                        displayText:
                            '✨ AI'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu image`,

                    buttonText: {
                        displayText:
                            '🖼️ Images'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu effects`,

                    buttonText: {
                        displayText:
                            '🎨 Effects'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu tools`,

                    buttonText: {
                        displayText:
                            '🛠️ Tools'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu group`,

                    buttonText: {
                        displayText:
                            '👥 Group'
                    },

                    type:
                        1
                },

                {
                    buttonId:
                        `${p}menu owner`,

                    buttonText: {
                        displayText:
                            '👑 Owner'
                    },

                    type:
                        1
                }

            ];
        }


        // ─────────────────────────────
        // SEND VISUAL MENU
        // ─────────────────────────────

        await socket.sendMessage(
            sender,
            {

                image: {
                    url:
                        botImage
                },

                caption:
                    caption,

                footer:
                    validCategory
                        ? `⚡ ${botName} • ${menuSections[category].length} Commands`
                        : `⚡ ${botName} • ${total} Commands • Choose a Category`,

                buttons:
                    buttons,

                headerType:
                    4,

                contextInfo: {

                    mentionedJid: [
                        sender
                    ],

                    forwardingScore:
                        999,

                    isForwarded:
                        true,

                    forwardedNewsletterMessageInfo: {

                        newsletterJid:
                            '120363418252392851@newsletter',

                        newsletterName:
                            '⚡ ALEXA-MINI ⚡',

                        serverMessageId:
                            143
                    },

                    externalAdReply: {

                        title:
                            validCategory
                                ? `${icons[category]} ${category.toUpperCase()} MENU`
                                : `${botName} • MAIN MENU`,

                        body:
                            validCategory
                                ? `${menuSections[category].length} Commands • All Menu`
                                : `Choose a category • ${total} Commands Available`,

                        thumbnailUrl:
                            botImage,

                        sourceUrl:
                            'https://github.com/watson-dev1',

                        mediaType:
                            1,

                        renderLargerThumbnail:
                            true
                    }
                }

            },
            {
                quoted:
                    msg
            }
        );


        console.log(
            validCategory
                ? `Menu category "${category}" opened for ${userName}`
                : `Main menu opened for ${userName}`
        );

    } catch (e) {

        console.error(
            'MENU ERROR:',
            e
        );

        try {

            await socket.sendMessage(
                sender,
                {
                    text:
`⚠️ *Menu Error*

${e.message || 'Unable to load menu.'}`
                },
                {
                    quoted:
                        msg
                }
            );

        } catch (sendError) {

            console.error(
                'MENU ERROR SEND FAILED:',
                sendError
            );
        }
    }

    break;
}
 case 'system':
    await socket.sendMessage(sender, {
        image: { url: config.IK_IMAGE_PATH },
        caption: `┏━━【 ✨ᴀʟᴇxᴀ ᴍɪɴɪ ʙᴏᴛ ꜱᴛᴀᴛᴜꜱ ᴅᴀꜱʜʙᴏᴀʀᴅ 】━━◉\n┃\n┣ 🏓 *PING:* PONG!\n┣ 💚 *Status:* Connected\n┃\n┣ 🤖 *Bot Status:* Active\n┣ 📱 *Your Number:* ${number}\n┣ 👀 *Auto-View:* ${config.AUTO_VIEW_STATUS}\n┣ ❤️ *Auto-Like:* ${config.AUTO_LIKE_STATUS}\n┣ ⏺ *Auto-Recording:* ${config.AUTO_RECORDING}\n┃\n┣ 🔗 *Our Channels:*\n┃ 📱 WhatsApp: https://whatsapp.com/channel/0029VbDTiJkC6Zvm9MZaKs3j\n┃\n┗━━━━━━━【𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐖𝐀𝐓𝐒𝐎𝐍-𝐗𝐃】━━━━━━◉`
    });
    break;
            case 'fc': {
    if (args.length === 0) {
        return await socket.sendMessage(sender, {
            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 1203634182392851@newsletter'
        });
    }

    const jid = args[0];
    if (!jid.endsWith("@newsletter")) {
        return await socket.sendMessage(sender, {
            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
        });
    }

    try {
        const metadata = await socket.newsletterMetadata("jid", jid);
        if (metadata?.viewer_metadata === null) {
            await socket.newsletterFollow(jid);
            await socket.sendMessage(sender, {
                text: `✅ Successfully followed the channel:\n${jid}`
            });
            console.log(`FOLLOWED CHANNEL: ${jid}`);
        } else {
            await socket.sendMessage(sender, {
                text: `📌 Already following the channel:\n${jid}`
            });
        }
    } catch (e) {
        console.error('❌ Error in follow channel:', e.message);
        await socket.sendMessage(sender, {
            text: `❌ Error: ${e.message}`
      });
   }
           break;
            }
case 'tagall': {
    try {
        // ✅ Group check
        if (!isGroup) {
            await socket.sendMessage(sender, { text: "❌ This command can only be used in groups." }, { quoted: msg });
            break;
        }

        // ✅ Permission check (Owner or Group Admin)
        if (!isOwner && !isGroupAdmin) {
            await socket.sendMessage(sender, { text: "❌ Only group admins or the bot owner can use this command." }, { quoted: msg });
            break;
        }

        // ✅ Fetch group info
        const groupInfo = await socket.groupMetadata(sender).catch(() => null);
        if (!groupInfo) {
            await socket.sendMessage(sender, { text: "❌ Failed to fetch group info." }, { quoted: msg });
            break;
        }

        const groupName = groupInfo.subject || "Unknown Group";
        const participants = groupInfo.participants || [];
        const totalMembers = participants.length;

        if (totalMembers === 0) {
            await socket.sendMessage(sender, { text: "❌ No members found in this group." }, { quoted: msg });
            break;
        }

        // ✅ Extract message after command
        const q = msg.message?.conversation ||
                  msg.message?.extendedTextMessage?.text || '';
        let message = q.replace(/^[.\/!]tagall\s*/i, '').trim();
        if (!message) message = "Attention Everyone!";

        // ✅ Random emoji for style
        const emojis = ['📢','🔊','🌐','🔰','❤‍🩹','🤍','🖤','🩵','📝','💗','🔖','🪩','📦','🎉','🛡️','💸','⏳','🗿','🚀','🎧','🪀','⚡','🚩','🍁','🗣️','👻','⚠️','🔥'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        // ✅ Build mention text
        let teks = `▢ Group : *${groupName}*\n▢ Members : *${totalMembers}*\n▢ Message: *${message}*\n\n┌───⊷ *MENTIONS*\n`;
        for (let mem of participants) {
            if (!mem.id) continue;
            teks += `${randomEmoji} @${mem.id.split('@')[0]}\n`;
        }
        teks += "└──✪ ᗩᒪE᙭ᗩ-ᗰIᑎ ✪──";

        // ✅ Send with mentions
        await socket.sendMessage(sender, { 
            text: teks, 
            mentions: participants.map(a => a.id) 
        }, { quoted: msg });

    } catch (err) {
        console.error("TagAll Error:", err);
        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }
    break;
}            
case 'flux':
case 'fluxai': {
    await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
    const axios = require('axios');

    let q =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    q = q.replace(/^\.(flux|imagine|gen|ai)\s*/i, '').trim();

    if (!q) {
        return await socket.sendMessage(sender, {
            text: `🎨 *AI Image Generator*\n\nUsage:\n.imagine <prompt> --model [flux/sdxl/anime/realistic] --neg [negative] --ar [1:1/16:9/9:16] --hd\n\nExample:\n.imagine beautiful girl --model anime --hd --ar 9:16`
        });
    }

    // Parse advanced args
    const getArg = (flag) => {
        const match = q.match(new RegExp(`${flag}\\s+([^\\-]+)`, 'i'));
        return match ? match[1].trim() : null;
    };
    const hasFlag = (flag) => new RegExp(flag, 'i').test(q);

    let model = getArg('--model') || 'flux'; // flux, sdxl, anime, realistic
    let negative = getArg('--neg') || 'blurry, low quality, distorted, watermark';
    let ar = getArg('--ar') || '1:1';
    let isHD = hasFlag('--hd');

    // Clean prompt from flags
    let prompt = q.split('--')[0].trim();
    if (!prompt) prompt = q;

    // Aspect ratio to width/height
    let width = 1024, height = 1024;
    if (ar === '16:9') { width = 1280; height = 720; }
    if (ar === '9:16') { width = 720; height = 1280; }
    if (ar === '4:3') { width = 1024; height = 768; }
    if (isHD) { width *= 1.5; height *= 1.5; } // HD upscale

    // Model mapping for Pollinations
    let pollModel = 'flux';
    if (model.includes('anime')) pollModel = 'anime';
    if (model.includes('real')) pollModel = 'flux-realism';
    if (model.includes('sdxl') || model.includes('turbo')) pollModel = 'turbo';

    try {
        await socket.sendMessage(sender, {
            text: `🧠 *Generating...*\n\n📌 *Prompt:* ${prompt}\n🎨 *Model:* ${model}\n📐 *Size:* ${width}x${height} ${isHD ? '(HD)' : ''}`,
        });

        let imageBuffer = null;

        // API 1: Pollinations (BEST - supports models)
        try {
            const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=${pollModel}&nologo=true&enhance=true&negative=${encodeURIComponent(negative)}&seed=${Math.floor(Math.random()*999999)}`;
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 40000 });
            if (res.data) imageBuffer = Buffer.from(res.data);
        } catch (e) { console.log('Polli fail', e.message); }

        // API 2: Fallback - NexOracle Flux
        if (!imageBuffer) {
            try {
                const url2 = `https://api.nexoracle.com/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                const res2 = await axios.get(url2, { responseType: 'arraybuffer', timeout: 40000 });
                imageBuffer = Buffer.from(res2.data, 'binary');
            } catch (e) { console.log('NexOracle fail', e.message); }
        }

        // API 3: Last fallback - prodia sdxl
        if (!imageBuffer) {
            try {
                const url3 = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ' , high detail, 8k')}`
                const res3 = await axios.get(url3, { responseType: 'arraybuffer', timeout: 40000 });
                imageBuffer = Buffer.from(res3.data);
            } catch {}
        }

        if (!imageBuffer) throw new Error('All APIs down');

        await socket.sendMessage(sender, {
            image: imageBuffer,
            caption: `🧠 *ᴀʟᴇxᴀ ᴍɪɴɪ ʙᴏᴛ ᴀɪ ɪᴍᴀɢᴇ*\n\n📌 ᴘʀᴏᴍᴘᴛ: ${prompt}\n🎨 ᴍᴏᴅᴇʟ: ${model} | 📐 ${ar} ${isHD?'[HD]':''}\n\n> *ɢᴇɴᴇʀᴀᴛᴇᴅ ʙʏ ᴘʀᴇᴄɪᴏᴜꜱ ᴍɪɴ*`
        }, { quoted: fakevCard });

    } catch (err) {
        console.error('AI Image Error:', err);
        await socket.sendMessage(sender, {
            text: `❗ *Failed to generate*: ${err.message}\nTry simpler prompt without special characters.`
        });
    }
    break;
}
case 'getpp':
case 'pp':
case 'profilepic': {
await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
    try {
        let targetUser = sender;
        
        // Check if user mentioned someone or replied to a message
        if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.quoted) {
            targetUser = msg.quoted.sender;
        }
        
        const ppUrl = await socket.profilePictureUrl(targetUser, 'image').catch(() => null);
        
        if (ppUrl) {
            await socket.sendMessage(msg.key.remoteJid, {
                image: { url: ppUrl },
                caption: `ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ᴏғ @${targetUser.split('@')[0]}`,
                mentions: [targetUser]
            });
        } else {
            await socket.sendMessage(msg.key.remoteJid, {
                text: `@${targetUser.split('@')[0]} ᴅᴏᴇsɴ'ᴛ ʜᴀᴠᴇ ᴀ ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ.`,
                mentions: [targetUser]
            });
        }
    } catch (error) {
        await socket.sendMessage(msg.key.remoteJid, {
            text: "Error fetching profile picture."
        });
    }
    break;
}            
          case 'weather':
    try {
        // Messages in English
        const messages = {
            noCity: "❗ *Please provide a city name!* \n📋 *Usage*: .weather [city name]",
            weather: (data) => `
*⛩️  𝐀𝐋𝐄𝐗𝐀-𝐌𝐈𝐍  𝐖𝐄𝐀𝐓𝐇𝐄𝐑 𝐑𝐄𝐏𝐎𝐑𝐓 🌤*

*━🌍 ${data.name}, ${data.sys.country} 🌍━*

*🌡️ Temperature*: _${data.main.temp}°C_

*🌡️ Feels Like*: _${data.main.feels_like}°C_

*🌡️ Min Temp*: _${data.main.temp_min}°C_

*🌡️ Max Temp*: _${data.main.temp_max}°C_

*💧 Humidity*: ${data.main.humidity}%

*☁️ Weather*: ${data.weather[0].main}

*🌫️ Description*: _${data.weather[0].description}_

*💨 Wind Speed*: ${data.wind.speed} m/s

*🔽 Pressure*: ${data.main.pressure} hPa

> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ
`,
            cityNotFound: "🚫 *City not found!* \n🔍 Please check the spelling and try again.",
            error: "⚠️ *An error occurred!* \n🔄 Please try again later."
        };

        // Check if a city name was provided
        if (!args || args.length === 0) {
            await socket.sendMessage(sender, { text: messages.noCity });
            break;
        }

        const apiKey = '2d61a72574c11c4f36173b627f8cb177';
        const city = args.join(" ");
        const url = `http://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;

        const response = await axios.get(url);
        const data = response.data;

        // Get weather icon
        const weatherIcon = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
        
        await socket.sendMessage(sender, {
            image: { url: weatherIcon },
            caption: messages.weather(data)
        });

    } catch (e) {
        console.log(e);
        if (e.response && e.response.status === 404) {
            await socket.sendMessage(sender, { text: messages.cityNotFound });
        } else {
            await socket.sendMessage(sender, { text: messages.error });
        }
    }
    break;
    case 'jid':
    try {

        const chatJid = sender;
        
        await socket.sendMessage(sender, {
            text: `${chatJid}`
        });

        await socket.sendMessage(sender, { 
            react: { text: '✅', key: messageInfo.key } 
        });

    } catch (e) {
        await socket.sendMessage(sender, { 
            react: { text: '❌', key: messageInfo.key } 
        });
        
        await socket.sendMessage(sender, {
            text: 'Error while retrieving the JID!'
        });
        
        console.log(e);
    }
    break;

case 'yts': {
    const yts = require('yt-search');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const query = q.replace(/^[.\/!](yts)\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '🔎 *Usage:* .yts <search query>'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, { text: "⏳ Searching YouTube, please wait..." }, { quoted: msg });

        const { videos } = await yts(query);
        if (!videos || videos.length === 0) {
            return await socket.sendMessage(sender, { text: "❌ No results found!" }, { quoted: msg });
        }

        // Limit results to 10
        const topResults = videos.slice(0, 10);

        let resultText = `*🔎 YouTube Search Results for:* ${query}\n\n`;
        topResults.forEach((vid, i) => {
            resultText += `*${i + 1}. ${vid.title}*\n`;
            resultText += `⏱ Duration: ${vid.timestamp}\n`;
            resultText += `👀 Views: ${vid.views.toLocaleString()}\n`;
            resultText += `📅 Uploaded: ${vid.ago}\n`;
            resultText += `🔗 Link: ${vid.url}\n\n`;
        });

        resultText += `> *© ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ*`;

        await socket.sendMessage(sender, { text: resultText }, { quoted: msg });

    } catch (err) {
        console.error("YouTube Search error:", err);
        await socket.sendMessage(sender, {
            text: `❌ Error occurred:\n${err.message}`
        }, { quoted: msg });
    }

    break;
}
               case 'fb':
case 'facebook':
case 'fbdl': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^[.\/!](facebook|fb)(dl)?\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '📃 *Usage :* .facebook `<link>`\n\nExample: .fb https://www.facebook.com/share/v/xxxx/'
        }, { quoted: msg });
    }

    if (!/(facebook\.com|fb\.watch|fb\.com)/i.test(link)) {
        return await socket.sendMessage(sender, { text: '*Invalid Facebook link.*' }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, { text: '⏳ *Downloading FB video, please wait...*' }, { quoted: msg });

        let result = null;
        const apis = [
            `https://api.vreden.my.id/api/fbdl?url=${encodeURIComponent(link)}`,
            `https://api.nexoracle.com/api/downloader/fb?url=${encodeURIComponent(link)}`,
            `https://api.davidcyriltech.my.id/facebook?url=${encodeURIComponent(link)}`,
            `https://api.siputzx.my.id/api/d/fbdl?url=${encodeURIComponent(link)}`
        ];

        for (const apiUrl of apis) {
            try {
                console.log(`Trying FB API: ${apiUrl}`);
                const { data } = await axios.get(apiUrl, { timeout: 15000 });
                
                // Normalize different API responses
                if (data?.data?.hd || data?.data?.sd) {
                    result = { hd: data.data.hd, sd: data.data.sd, title: data.data.title || "Facebook Video", thumb: data.data.thumbnail };
                    break;
                }
                if (data?.result?.hd || data?.result?.sd) {
                    result = { hd: data.result.hd, sd: data.result.sd, title: data.result.title, thumb: data.result.thumb };
                    break;
                }
                if (data?.BK9?.hd || data?.BK9?.sd) {
                    result = data.BK9;
                    break;
                }
                if (data?.hd || data?.sd) {
                    result = data;
                    break;
                }
                if (data?.status && data?.data) {
                    result = data.data;
                    break;
                }
            } catch (e) {
                console.log(`FB API failed: ${apiUrl} - ${e.message}`);
                continue;
            }
        }

        if (!result) {
            return await socket.sendMessage(sender, { text: '*❌ Failed to fetch FB video. All APIs are down or link is private.*' }, { quoted: msg });
        }

        const videoUrl = result.hd || result.sd || result.HD || result.SD || result.video || result.url;
        const quality = result.hd ? "HD ✅" : "SD ⚡";

        if (!videoUrl) {
            return await socket.sendMessage(sender, { text: '*No downloadable video found. Maybe private/group video.*' }, { quoted: msg });
        }

        const caption = `╭──────────────◆\n📬 *Title:* ${result.title || result.caption || 'Facebook Video'}\n🎞 *Quality:* ${quality}\n╰──────────────◆`;

        // Try get thumbnail
        let thumbBuffer = null;
        try {
            if (result.thumb || result.thumbnail) {
                const thumbUrl = result.thumb || result.thumbnail;
                const thumbRes = await axios.get(thumbUrl, { responseType: "arraybuffer", timeout: 10000 });
                thumbBuffer = Buffer.from(thumbRes.data);
            }
        } catch {}

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: caption,
            ...(thumbBuffer ? { jpegThumbnail: thumbBuffer } : {})
        }, { quoted: msg });

    } catch (err) {
        console.error("Fb command error:", err);
        await socket.sendMessage(sender, {
            text: `⚠️ Error: ${err.message}`
        }, { quoted: msg });
    }
    break;
}
                case 'owner': {
    const ownerNumber = '263781330745';
    const ownerName = 'watsonx';
    const organization = 'TEAM 804';

    const vcard = 'BEGIN:VCARD\n' +
                  'VERSION:3.0\n' +
                  `FN:${ownerName}\n` +
                  `ORG:${organization};\n` +
                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                  'END:VCARD';

    try {
        // Send vCard contact
        const sent = await socket.sendMessage(from, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            }
        });

        // Then send message with reference
        await socket.sendMessage(from, {
            text: `*alexamin 𝐎ᴡɴᴇʀs*\n\n👤 𝐍𝐀𝐌𝐄: ${ownerName}\n📞 𝐍𝐔𝐌𝐁𝐄𝐑: ${ownerNumber}\n\n> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`,
            contextInfo: {
                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                quotedMessageId: sent.key.id
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Owner command error:', err.message);
        await socket.sendMessage(from, {
            text: '❌ Error sending owner contact.'
        }, { quoted: msg });
    }

    break;
}

case 'boom': {
    if (!isOwner) {
        await socket.sendMessage(from, { 
            text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" 
        }, { quoted: fakevCard });
        break;
    }

    if (args.length < 2) {
        return await socket.sendMessage(sender, {   
            text: "📛 *Usage:* `.boom <count> <message>`\n📌 *Example:* `.boom 100 watson XD*`"   
        }, { quoted: msg });
    }

    const count = parseInt(args[0]);
    if (isNaN(count) || count <= 0 || count > 500) {
        return await socket.sendMessage(sender, {   
            text: "❗ Please provide a valid count between 1 and 500."   
        }, { quoted: msg });
    }

    const message = args.slice(1).join(" ");
    const delay = 700; // ms between messages (safe range: 700–1200)

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            socket.sendMessage(sender, { text: message }).catch(() => {});
        }, i * delay);
    }

    break;
}

case 'ai':
case 'ask':
case 'meta':
case 'gpt': {
    const axios = require("axios");

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || 
              '';

    const query = q.replace(/^[.\/!](ai|dj|meta|gpt)\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, { 
            text: "🤖 *Usage:* .ai <your question>\n\nExample: .ai who is messi?" 
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, { react: { text: '🤔', key: msg.key } });

        let aiReply = null;

        // List of working AI APIs - it will try one by one
        const apis = [
            // 1. Pollinations AI (MOST STABLE - no key)
            async () => {
                const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(query)}?model=openai`, { timeout: 20000 });
                return res.data;
            },
            // 2. Vreden GPT
            async () => {
                const res = await axios.get(`https://api.vreden.my.id/api/gpt?query=${encodeURIComponent(query)}`, { timeout: 15000 });
                return res.data?.result || res.data?.data || res.data?.answer;
            },
            // 3. NexOracle ChatGPT
            async () => {
                const res = await axios.get(`https://api.nexoracle.com/api/ai/chatgpt?prompt=${encodeURIComponent(query)}`, { timeout: 15000 });
                return res.data?.result || res.data?.data;
            },
            // 4. David Cyril Tech
            async () => {
                const res = await axios.get(`https://api.davidcyriltech.my.id/ai/chatbot?query=${encodeURIComponent(query)}`, { timeout: 15000 });
                return res.data?.result || res.data?.response;
            },
            // 5. Dreaded API
            async () => {
                const res = await axios.get(`https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(query)}`, { timeout: 15000 });
                return res.data?.result?.response || res.data?.result;
            }
        ];

        for (const callApi of apis) {
            try {
                const result = await callApi();
                if (result && typeof result === 'string' && result.length > 5) {
                    aiReply = result;
                    break;
                }
            } catch (e) {
                console.log('AI API failed, trying next:', e.message);
                continue;
            }
        }

        if (!aiReply) {
            return await socket.sendMessage(sender, { 
                text: "❌ *All AI APIs are busy. Try again in 20 seconds.*" 
            }, { quoted: msg });
        }

        // Clean reply
        aiReply = aiReply.toString().trim();

        await socket.sendMessage(sender, { 
            text: `💡 *ALEXA-MIN AI:*\n\n${aiReply}` 
        }, { quoted: msg });

    } catch (err) {
        console.error("AI Command Error:", err);
        await socket.sendMessage(sender, { 
            text: `❌ Error: ${err.message}` 
        }, { quoted: msg });
    }
    break;
}

                    case 'tiktok':
case 'tt':
case 'ttdl': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^[.\/!](tiktok|tt)(dl)?\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '📌 *Usage:*.tiktok <link>\nExample:.tt https://vt.tiktok.com/xxxxx/'
        }, { quoted: msg });
    }

    if (!/(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(link)) {
        return await socket.sendMessage(sender, { text: '❌ *Invalid TikTok link.*' }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, { text: '⏳ *Downloading TikTok, please wait...*' }, { quoted: msg });

        let videoUrl = null;
        let audioUrl = null;
        let title = "TikTok Video";
        let author = "Unknown";
        let thumb = null;

        const apis = [
            `https://api.vreden.my.id/api/tiktok?url=${encodeURIComponent(link)}`,
            `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(link)}`,
            `https://api.davidcyriltech.my.id/tiktok?url=${encodeURIComponent(link)}`,
            `https://api.nexoracle.com/api/downloader/tiktok?url=${encodeURIComponent(link)}`,
            `https://www.tikwm.com/api/?url=${encodeURIComponent(link)}&hd=1`,
            `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`
        ];

        for (const apiUrl of apis) {
            try {
                const { data } = await axios.get(apiUrl, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });

                // TikWM
                if (data?.data?.play) {
                    videoUrl = data.data.play;
                    audioUrl = data.data.music;
                    title = data.data.title;
                    author = data.data.author?.nickname || data.data.author?.unique_id;
                    thumb = data.data.cover;
                    break;
                }
                // Vreden / David Cyril format
                if (data?.data?.hd || data?.data?.play || data?.data?.watermark === undefined) {
                    // Vreden returns { data: { data: [...] } } or { data: { play,... } }
                    const d = data.data.data? data.data.data[0] : data.data;
                    if (Array.isArray(d)) {
                        // photo slide
                    } else {
                        videoUrl = d.hd || d.play || d.no_watermark || d.wm || d.video;
                        audioUrl = d.music || d.audio;
                        title = d.title || d.caption || title;
                        author = d.author?.nickname || author;
                        if (videoUrl) break;
                    }
                }
                // NexOracle
                if (data?.result?.video) {
                    videoUrl = data.result.video;
                    title = data.result.title || title;
                    if (videoUrl) break;
                }
                // Delirius
                if (data?.data?.meta?.media) {
                    const media = data.data.meta.media.find(v => v.type === "video");
                    if (media?.org) {
                        videoUrl = media.org;
                        title = data.data.title;
                        author = data.data.author?.nickname;
                        break;
                    }
                }
                // Tiklydown
                if (data?.video?.noWatermark) {
                    videoUrl = data.video.noWatermark;
                    title = data.title || title;
                    break;
                }

            } catch (e) {
                console.log(`TT API fail ${apiUrl}: ${e.message}`);
                continue;
            }
        }

        if (!videoUrl) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch. Video is private or all APIs down.*' }, { quoted: msg });
        }

        const caption = `╭──────────────◆\n🎵 *TIKTOK NO-WATERMARK*\n👤 *Author:* ${author}\n📖 *Title:* ${title?.slice(0,100)}\n╰──────────────◆`;

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: caption,
            mimetype: 'video/mp4'
        }, { quoted: msg });

        // Send audio as optional extra
        if (audioUrl) {
            await socket.sendMessage(sender, {
                audio: { url: audioUrl },
                mimetype: 'audio/mp4',
                ptt: false
            }, { quoted: msg }).catch(()=>{});
        }

    } catch (err) {
        console.error("TikTok command error:", err);
        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }
    break;
}  
case 'hidetag': {
    try {
        if (!isGroup) {
            return await socket.sendMessage(
                sender,
                {
                    text: '❌ This command can only be used in groups.'
                },
                { quoted: msg }
            );
        }

        if (!isBotAdmins) {
            return await socket.sendMessage(
                sender,
                {
                    text: '❌ I need to be a group admin to use this command.'
                },
                { quoted: msg }
            );
        }

        if (!isAdmins && !isOwner) {
            return await socket.sendMessage(
                sender,
                {
                    text: '🚫 Only group admins can use `.hidetag`.'
                },
                { quoted: msg }
            );
        }

        const groupMetadata =
            await socket.groupMetadata(sender);

        const participants =
            groupMetadata.participants || [];

        const mentions =
            participants.map(
                participant => participant.id
            );

        const text =
            args.length > 0
                ? args.join(' ')
                : '📢 Attention everyone!';

        await socket.sendMessage(
            sender,
            {
                text: text,
                mentions: mentions
            },
            { quoted: msg }
        );

    } catch (error) {

        console.error(
            'HIDETAG ERROR:',
            error
        );

        await socket.sendMessage(
            sender,
            {
                text:
                    `❌ *Hidetag Error*\n\n${error.message || 'Unable to mention members.'}`
            },
            { quoted: msg }
        );
    }

    break;
}
case 'rules': {
    try {

        if (!isGroup) {
            return await socket.sendMessage(
                sender,
                {
                    text: '❌ This command can only be used in groups.'
                },
                { quoted: msg }
            );
        }

        const groupMetadata =
            await socket.groupMetadata(sender);

        const groupName =
            groupMetadata.subject || 'This Group';

        const rules =
`╭━━━〔 📜 GROUP RULES 〕━━━╮
┃
┃ 👋 Welcome to *${groupName}*
┃
┃ Please follow these rules to
┃ keep the group safe and friendly.
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 1️⃣ Respect everyone.
┃
┃ 2️⃣ No unnecessary spam.
┃
┃ 3️⃣ No illegal or harmful content.
┃
┃ 4️⃣ No NSFW content.
┃
┃ 5️⃣ No hate speech or harassment.
┃
┃ 6️⃣ Do not send suspicious links.
┃
┃ 7️⃣ Follow admin instructions.
┃
┃ 8️⃣ Do not flood the group with
┃    repeated messages or media.
┃
┃ 9️⃣ Use commands responsibly.
┃
┃ 🔟 Have fun and respect others! ❤️
┣━━━━━━━━━━━━━━━━━━━━
┃
┃ 🤖 *${botName || 'ALEXA-MIN'}*
┃ ⚡ Powered by ALEXA-MIN
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;

        await socket.sendMessage(
            sender,
            {
                text: rules
            },
            { quoted: msg }
        );

    } catch (error) {

        console.error(
            'RULES ERROR:',
            error
        );

        await socket.sendMessage(
            sender,
            {
                text:
                    `❌ *Rules Error*\n\n${error.message || 'Unable to show group rules.'}`
            },
            { quoted: msg }
        );
    }

    break;
}

case 'add':
case 'invite': {
    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
        }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ɪɴᴠɪᴛᴇ ᴍᴇᴍʙᴇʀs!*'
        }, { quoted: fakevCard });
        break;
    }

    if (args.length === 0) {
        await socket.sendMessage(sender, {
            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}invite +263xxxxx\n\nExample: ${config.PREFIX}invite +98xxxxx`
        }, { quoted: fakevCard });
        break;
    }

    try {
        const groupMetadata = await socket.groupMetadata(from); // 👈 yahan define karna zaroori ha
        const numberToInvite = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        const inviteCode = await socket.groupInviteCode(from);
        const groupLink = `https://chat.whatsapp.com/${inviteCode}`;

        let inviteMsg = `
╔══✪〘 *🌐 ɢʀᴏᴜᴘ ɪɴᴠɪᴛᴇ* 〙✪══
┃
┃  🔰 *ɢʀᴏᴜᴘ:* ${groupMetadata.subject}
┃  👑 *ɪɴᴠɪᴛᴇᴅ ʙʏ:* @${sender.split('@')[0]}
┃
┃  🔗 *ʟɪɴᴋ:* ${groupLink}
┃
╚═══════════════════╝
`;

        await socket.sendMessage(numberToInvite, { text: inviteMsg, mentions: [sender] });

        await socket.sendMessage(sender, {
            text: `✅ Invite link sent to ${args[0]} via inbox!`
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Invite command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ sᴇɴᴅ ɪɴᴠɪᴛᴇ*\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
case 'k':
case 'remove':              
case 'kick': {    
    await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } });    

    if (!isGroup) {    
        await socket.sendMessage(sender, {    
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'    
        }, { quoted: fakevCard });    
        break;    
    }    

    // 🚫 Restriction: Only Owner can kick
    if (!isOwner) {    
        await socket.sendMessage(sender, {    
            text: '❌ *ᴏɴʟʏ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ!*'    
        }, { quoted: fakevCard });    
        break;    
    }    

    if (args.length === 0 && !msg.quoted) {    
        await socket.sendMessage(sender, {    
            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}kick +263xxxxx ᴏʀ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ${config.PREFIX}kick`    
        }, { quoted: fakevCard });    
        break;    
    }    

    try {    
        let numberToKick;    
        if (msg.quoted) {    
            numberToKick = msg.quoted.sender;    
        } else {    
            numberToKick = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';    
        }    

        // 🚫 Prevent kicking the Owner himself
        if (numberToKick === sender) {    
            await socket.sendMessage(sender, {    
                text: `⚠️ You cannot kick *yourself* (${numberToKick.split('@')[0]})!`    
            }, { quoted: fakevCard });    
            break;    
        }    

        await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');    
        await socket.sendMessage(sender, {    
            text: `🗑️ 𝐌𝐄𝐌𝐁𝐄𝐑 𝐊𝐈𝐂𝐊𝐄𝐃\n\nsᴜᴄᴄᴇssғᴜʟʟʏ ʀᴇᴍᴏᴠᴇᴅ ${numberToKick.split('@')[0]} ғʀᴏᴍ ᴛʜᴇ ɢʀᴏᴜᴘ! 🚪`    
        }, { quoted: fakevCard });    

    } catch (error) {    
        console.error('Kick command error:', error);    
        await socket.sendMessage(sender, {    
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ᴋɪᴄᴋ ᴍᴇᴍʙᴇʀ!*\nError: ${error.message || 'Unknown error'}`    
        }, { quoted: fakevCard });    
    }    
    break;    
}
// Case: promote - Promote a member to group admin
case 'promote':
case 'p':
case 'admin': {
    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, { text: '❌ *This command can only be used in groups!*' }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, { text: '❌ *Only group admins or bot owner can promote members!*' }, { quoted: fakevCard });
        break;
    }

    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, { text: `📌 *Usage:* ${config.PREFIX}promote +263xxxxx or reply with ${config.PREFIX}promote` }, { quoted: fakevCard });
        break;
    }

    try {
        let numberToPromote;
        if (msg.quoted) {
            numberToPromote = msg.quoted.sender;
        } else {
            numberToPromote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }

        // ✅ Owner ko kabhi promote nahi karna
        if (isOwner && numberToPromote === sender) {
            await socket.sendMessage(sender, { text: '⚠️ *You cannot promote the bot owner!*' }, { quoted: fakevCard });
            break;
        }

        await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');
        await socket.sendMessage(sender, {
            text: `✅ Successfully promoted *@${numberToPromote.split('@')[0]}* to admin! 🎉`,
            mentions: [numberToPromote]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Promote command error:', error);
        await socket.sendMessage(sender, { text: `❌ Failed to promote member.\nError: ${error.message || 'Unknown error'}` }, { quoted: fakevCard });
    }
    break;
}
case 'leave':
case 'left': {
    await socket.sendMessage(sender, { react: { text: '🚪', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
        }, { quoted: fakevCard });
        break;
    }

    // 🚫 Restriction: Only Owner can use
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴍᴀᴋᴇ ᴛʜᴇ ʙᴏᴛ ʟᴇᴀᴠᴇ!*'
        }, { quoted: fakevCard });
        break;
    }

    try {
        await socket.sendMessage(from, {
            text: '👋 *I am leaving this group now, Bye!*'
        }, { quoted: fakevCard });

        // Leave group
        await socket.groupLeave(from);

    } catch (error) {
        console.error('Leave command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ʟᴇᴀᴠᴇ ᴛʜᴇ ɢʀᴏᴜᴘ!*\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}

// Case: demote - Demote a group admin to member
case 'demote':
case 'd':
case 'dismiss': {
    await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, { text: '❌ *This command can only be used in groups!*' }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, { text: '❌ *Only group admins or bot owner can demote admins!*' }, { quoted: fakevCard });
        break;
    }

    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, { text: `📌 *Usage:* ${config.PREFIX}demote +263xxxxx or reply with ${config.PREFIX}demote` }, { quoted: fakevCard });
        break;
    }

    try {
        let numberToDemote;
        if (msg.quoted) {
            numberToDemote = msg.quoted.sender;
        } else {
            numberToDemote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }

        // Check if the number to demote is valid
        if (!numberToDemote || numberToDemote === 'undefined@s.whatsapp.net') {
            await socket.sendMessage(sender, { text: '❌ *Invalid user number!*' }, { quoted: fakevCard });
            break;
        }

        // Check if trying to demote bot owner
        if (ownerNumbers.includes(numberToDemote)) {
            await socket.sendMessage(sender, { text: '⚠️ *You cannot demote the bot owner!*' }, { quoted: fakevCard });
            break;
        }

        // Check if trying to demote self (if sender is admin)
        if (numberToDemote === sender && isSenderGroupAdmin) {
            await socket.sendMessage(sender, { text: '⚠️ *You cannot demote yourself!*' }, { quoted: fakevCard });
            break;
        }

        // Check if the user is already a member (not admin)
        const groupMetadata = await socket.groupMetadata(from);
        const participant = groupMetadata.participants.find(p => p.id === numberToDemote);
        
        if (!participant || participant.admin === null) {
            await socket.sendMessage(sender, { text: '❌ *This user is already a member (not an admin)!*' }, { quoted: fakevCard });
            break;
        }

        // Perform demotion
        await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');
        await socket.sendMessage(sender, {
            text: `✅ Successfully demoted *@${numberToDemote.split('@')[0]}* from admin! 👋`,
            mentions: [numberToDemote]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Demote command error:', error);
        await socket.sendMessage(sender, { text: `❌ Failed to demote admin.\nError: ${error.message || 'Unknown error'}` }, { quoted: fakevCard });
    }
    break;
}
// Case: mute - only admins/owner can mute group
case 'mute':
case 'close':
case 'm': {
    await socket.sendMessage(sender, { react: { text: '🔇', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, { text: '❌ *This command can only be used in groups!*' }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, { text: '❌ *Only group admins or bot owner can mute the group!*' }, { quoted: fakevCard });
        break;
    }

    try {
        await socket.groupSettingUpdate(from, 'announcement'); // jawad Only admins can send messages
        await socket.sendMessage(sender, { text: '🔇 *Group has been muted! Only admins can send messages now.*' }, { quoted: fakevCard });
    } catch (error) {
        console.error('Mute command error:', error);
        await socket.sendMessage(sender, { text: `❌ Failed to mute group.\nError: ${error.message || 'Unknown error'}` }, { quoted: fakevCard });
    }
    break;
}

// Case: unmute - only admins/owner can unmute group
case 'unmute':
case 'open':
case 'um': {
    await socket.sendMessage(sender, { react: { text: '🔊', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, { text: '❌ *This command can only be used in groups!*' }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, { text: '❌ *Only group admins or bot owner can unmute the group!*' }, { quoted: fakevCard });
        break;
    }

    try {
        await socket.groupSettingUpdate(from, 'not_announcement'); // ✅ Everyone can send messages
        await socket.sendMessage(sender, { text: '🔊 *Group has been unmuted! Everyone can send messages now.*' }, { quoted: fakevCard });
    } catch (error) {
        console.error('Unmute command error:', error);
        await socket.sendMessage(sender, { text: `❌ Failed to unmute group.\nError: ${error.message || 'Unknown error'}` }, { quoted: fakevCard });
    }
    break;
}
case 'join': {
    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

    // ✅ Sirf owner use kar sakta hai
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: "📛 *This is an owner-only command!*"
        }, { quoted: fakevCard });
        break;
    }

    let groupLink;

    // Agar reply me group invite link diya gaya
    if (msg.quoted && msg.quoted.text && msg.quoted.text.startsWith("https://chat.whatsapp.com/")) {
        groupLink = msg.quoted.text.split("https://chat.whatsapp.com/")[1];
    } 
    // Agar command ke sath link diya gaya
    else if (args[0] && args[0].startsWith("https://chat.whatsapp.com/")) {
        groupLink = args[0].split("https://chat.whatsapp.com/")[1];
    }

    if (!groupLink) {
        await socket.sendMessage(sender, {
            text: "❌ *Invalid Group Link Format* 🖇️"
        }, { quoted: fakevCard });
        break;
    }

    // Remove query params
    groupLink = groupLink.split("?")[0];

    // Contact-style quote
    let gift = {
        key: {
            fromMe: false,
            participant: `0@s.whatsapp.net`,
            remoteJid: "status@broadcast"
        },
        message: {
            contactMessage: {
                displayName: `ALEXA-MIN`,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;a,;;;\nFN:'GIFTED'\nitem1.TEL;waid=${msg.sender.split("@")[0]}:${msg.sender.split("@")[0]}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            }
        }
    };

    try {
        // ✅ Join Group
        await socket.groupAcceptInvite(groupLink);

        await socket.sendMessage(sender, {
            text: `✔️ *Successfully Joined The Group!*`
        }, { quoted: gift });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error("Join command error:", e);

        if (e.message && (e.message.includes("already") || e.status === 409)) {
            await socket.sendMessage(sender, {
                text: "❌ *I'm already in this group!*"
            }, { quoted: gift });
        } else if (e.message && (e.message.includes("reset") || e.message.includes("expired") || e.message.includes("gone"))) {
            await socket.sendMessage(sender, {
                text: "❌ *This link has expired or been reset!*"
            }, { quoted: gift });
        } else if (e.message && (e.message.includes("invalid") || e.message.includes("bad-request"))) {
            await socket.sendMessage(sender, {
                text: "❌ *Invalid group link!*"
            }, { quoted: gift });
        } else {
            await socket.sendMessage(sender, {
                text: `❌ *Error Occurred!!*\n\n${e.message}`
            }, { quoted: gift });
        }
    }
    break;
}

case 'kickall':
case 'removeall':
case 'end':
case 'cleargroup': {
    await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

    if (!isGroup) {
        return await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups!*'
        }, { quoted: fakevCard });
    }

    if (!isOwner) {
        return await socket.sendMessage(sender, {
            text: '📛 *This is an owner-only command!*'
        }, { quoted: fakevCard });
    }

    try {
        const groupMetadata = await socket.groupMetadata(from);
        const botJid = socket.user?.id || socket.user?.jid;
        const participants = groupMetadata.participants || [];

        // 🚫 Exclude: Bot & Owner (sender)
        const jids = participants
            .filter(p => p.id !== botJid && p.id !== sender)
            .map(p => p.id);

        if (jids.length === 0) {
            return await socket.sendMessage(sender, {
                text: '✅ No members to remove (only owner & bot left).'
            }, { quoted: fakevCard });
        }

        await socket.groupParticipantsUpdate(from, jids, "remove")
            .catch(() => socket.sendMessage(sender, {
                text: "⚠️ Failed to remove some members (maybe I’m not admin)."
            }, { quoted: fakevCard }));

        await socket.sendMessage(sender, {
            text: `🧹 *Group Cleaned!*\n\n✅ Removed *${jids.length}* members.\n\n> Owner & Bot are safe ✅`
        }, { quoted: fakevCard });

    } catch (error) {
        console.error("Kickall command error:", error);
        await socket.sendMessage(sender, {
            text: `❌ Failed to remove members.\nError: ${error.message}`
        }, { quoted: fakevCard });
    }
    break;
}

case 'apk':
case 'playstore': {
const axios = require('axios');

try {
    const appName = args.join(' ').trim();

    if (!appName) {
        return await socket.sendMessage(sender, {
            text:

`📌 Usage:
${config?.PREFIX || '.'}apk <app name>

📱 Example:
${config?.PREFIX || '.'}apk WhatsApp`
}, { quoted: msg });
}

    await socket.sendMessage(sender, {
        react: { text: '🔎', key: msg.key }
    });

    const searchUrl =
        `https://play.google.com/store/search?q=${encodeURIComponent(appName)}&c=apps`;

    await socket.sendMessage(sender, {
        text:

`📱 PLAY STORE SEARCH

🔎 App: ${appName}

🔗 ${searchUrl}`
}, { quoted: msg });

    await socket.sendMessage(sender, {
        react: { text: '✅', key: msg.key }
    });

} catch (error) {
    console.error('APK SEARCH ERROR:', error);

    await socket.sendMessage(sender, {
        text:

"❌ *Search failed:* ${error.message || 'Something went wrong.'}"
}, { quoted: msg });
}

break;

}

case 'npm':
case 'npmstalk': {
    const axios = require('axios');
    try {
        const packageName = (args.join(" ") || q.replace(/^[.\/!](npm|npmstalk)\s*/i, '').trim()).trim();
        if (!packageName) return await socket.sendMessage(sender, { text: "❌ Usage:.npm express" }, { quoted: fakevCard });

        const { data } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { timeout: 10000 });
        const latest = data["dist-tags"]?.latest;
        const info = data.versions?.[latest] || {};

        const txt = `*📦 NPM - ${packageName}*\n\n📄 ${data.description || 'No desc'}\n📦 Latest: ${latest}\n🪪 License: ${info.license || data.license || 'Unknown'}\n📅 Updated: ${new Date(data.time?.[latest]).toLocaleDateString()}\n🔗 https://www.npmjs.com/package/${packageName}`;
        await socket.sendMessage(sender, { text: txt }, { quoted: fakevCard });
    } catch (e) {
        await socket.sendMessage(sender, { text: `❌ Package not found: ${e.message}` }, { quoted: fakevCard });
    }
    break;
}

case 'fetch': {
    const axios = require('axios');

    try {
        const url = (
            args.join(' ') ||
            q?.replace(/^[.\/!]fetch\s*/i, '').trim()
        ).trim();

        if (!url) {
            return await socket.sendMessage(sender, {
                text:
`❌ *Please provide a URL.*

📌 *Usage:*
${config?.PREFIX || '.'}fetch https://api.github.com/users/github`
            }, { quoted: fakevCard });
        }

        // Validate URL
        let parsedUrl;

        try {
            parsedUrl = new URL(url);
        } catch {
            return await socket.sendMessage(sender, {
                text: '❌ Invalid URL.'
            }, { quoted: fakevCard });
        }

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return await socket.sendMessage(sender, {
                text: '❌ URL must start with http:// or https://.'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, {
            react: {
                text: '🔎',
                key: msg.key
            }
        });

        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Alexa-Mini/3.0'
            },
            validateStatus: () => true
        });

        const status = response.status;

        const contentType =
            response.headers['content-type'] || 'Unknown';

        let content;

        if (
            typeof response.data === 'object' &&
            response.data !== null
        ) {
            content = JSON.stringify(
                response.data,
                null,
                2
            );
        } else {
            content = String(response.data);
        }

        // Prevent huge WhatsApp messages
        if (content.length > 3000) {
            content =
                content.slice(0, 3000) +
                '\n...truncated';
        }

        const statusEmoji =
            status >= 200 && status < 300
                ? '✅'
                : '⚠️';

        // IMPORTANT:
        // Don't use ``` inside a JS template literal.
        const resultText =
`🔍 *FETCH RESULT*

╭───❖ *REQUEST* ❖───
│ 🔗 *URL:* ${url}
│ 📊 *Status:* ${statusEmoji} ${status}
│ 📄 *Type:* ${contentType}
╰───────────────❖

📄 *Response:*

${content}`;

        await socket.sendMessage(sender, {
            text: resultText
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (e) {
        console.error(
            'FETCH COMMAND ERROR:',
            e.response?.data || e.message
        );

        await socket.sendMessage(sender, {
            text:
`❌ *Fetch Error:*

${e.message || 'Unable to fetch the URL.'}`
        }, { quoted: fakevCard });
    }

    break;
}
case 'welcome': {
    if (!isGroup) {
        return await socket.sendMessage(
            sender,
            { text: '❌ This command is only for groups.' },
            { quoted: msg }
        );
    }

    if (!isAdmin) {
        return await socket.sendMessage(
            sender,
            { text: '❌ Admins only.' },
            { quoted: msg }
        );
    }

    const option =
        String(args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(option)) {
        return await socket.sendMessage(
            sender,
            {
                text:
`👋 *WELCOME SETTINGS*

Usage:
${p}welcome on
${p}welcome off

Current:
${groupSettings.get(sender)?.welcome ? 'ON 🟢' : 'OFF 🔴'}`
            },
            { quoted: msg }
        );
    }

    const current =
        groupSettings.get(sender) || {
            welcome: false,
            goodbye: false
        };

    current.welcome =
        option === 'on';

    groupSettings.set(sender, current);

    await socket.sendMessage(
        sender,
        {
            text:
`👋 *WELCOME ${option === 'on' ? 'ENABLED 🟢' : 'DISABLED 🔴'}*

New members will ${option === 'on' ? 'now receive a welcome message.' : 'no longer receive welcome messages.'}`
        },
        { quoted: msg }
    );

    break;
}
case 'goodbye': {
    if (!isGroup) {
        return await socket.sendMessage(
            sender,
            { text: '❌ This command is only for groups.' },
            { quoted: msg }
        );
    }

    if (!isAdmin) {
        return await socket.sendMessage(
            sender,
            { text: '❌ Admins only.' },
            { quoted: msg }
        );
    }

    const option =
        String(args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(option)) {
        return await socket.sendMessage(
            sender,
            {
                text:
`👋 *GOODBYE SETTINGS*

Usage:
${p}goodbye on
${p}goodbye off`
            },
            { quoted: msg }
        );
    }

    const current =
        groupSettings.get(sender) || {
            welcome: false,
            goodbye: false
        };

    current.goodbye =
        option === 'on';

    groupSettings.set(sender, current);

    await socket.sendMessage(
        sender,
        {
            text:
`👋 *GOODBYE ${option === 'on' ? 'ENABLED 🟢' : 'DISABLED 🔴'}*`
        },
        { quoted: msg }
    );

    break;
}
case 'image':
case 'img': {
    const axios = require('axios');
    try {
        const query = (args.join(' ') || '').trim() || q.replace(/^[.\/!]img(e)?\s*/i, '').trim();
        if (!query) {
            await socket.sendMessage(sender, { text: '📌 Usage:.img <search>\nEx:.img Ronaldo' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

        // Pollinations is google-like and never dies
        // We generate 4 images from search term using Pollinations + send real Google scrape as backup
        const count = 4;
        for(let i=0; i<count; i++){
            const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(query + ' high quality photo') }?width=1024&height=1024&seed=${Math.floor(Math.random()*10000)}&nologo=true`;
            await socket.sendMessage(sender, {
                image: { url: imgUrl },
                caption: `🔍 *Result for:* ${query} [${i+1}/${count}]`
            }, { quoted: fakevCard });
        }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) {
        await socket.sendMessage(sender, { text: `❌ Error: ${e.message}` }, { quoted: fakevCard });
    }
    break;
}

// ========== VIRAL DOWNLOADER PACK - ALEXA-MIN ==========

case 'ig': case 'instagram': case 'igdl': case 'reel': {
    const axios = require('axios');
    try {
        const link = args[0] || q;
        if (!link ||!link.includes('instagram.com')) return await socket.sendMessage(sender, { text: `📌 Usage: ${config?.PREFIX||'.'}ig <instagram link>\nEx:.ig https://www.instagram.com/reel/xxxxx/` }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
        let videoUrl = null, imgUrl = null, type = 'video';

        const apis = [
            `https://api.vreden.my.id/api/igdl?url=${encodeURIComponent(link)}`,
            `https://api.davidcyriltech.my.id/instagram?url=${encodeURIComponent(link)}`,
            `https://api.nexoracle.com/api/downloader/ig?url=${encodeURIComponent(link)}`
        ];

        for (const api of apis) {
            try {
                const { data } = await axios.get(api, { timeout: 20000 });
                const r = data.result || data.data || data;
                if (r.url) { videoUrl = r.url; type = r.type || 'video'; break; }
                if (Array.isArray(r) && r[0]?.url) { videoUrl = r[0].url; break; }
                if (r.video) { videoUrl = r.video; break; }
                if (r.downloadUrl) { videoUrl = r.downloadUrl; break; }
            } catch {}
        }

        if (!videoUrl &&!imgUrl) return await socket.sendMessage(sender, { text: "❌ Failed. Link may be private or API down. Try again." }, { quoted: msg });

        if (type === 'image' || imgUrl) {
            await socket.sendMessage(sender, { image: { url: videoUrl || imgUrl }, caption: "> ALEXA-MIN IG DL" }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { video: { url: videoUrl }, caption: "> ALEXA-MIN IG DL ✅" }, { quoted: msg });
        }

    } catch (e) { await socket.sendMessage(sender, { text: `❌ IG Error: ${e.message}` }, { quoted: msg }); }
    break;
}

case 'fb1': case 'facebook1': case 'fbdl': {
    const axios = require('axios');
    try {
        const link = args[0] || q;
        if (!link) return await socket.sendMessage(sender, { text: `📌.fb <fb video link>` }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        let vUrl = null;
        const apis = [
            `https://api.vreden.my.id/api/fbdl?url=${encodeURIComponent(link)}`,
            `https://api.davidcyriltech.my.id/facebook?url=${encodeURIComponent(link)}`
        ];
        for (const api of apis) {
            try {
                const { data } = await axios.get(api, { timeout: 20000 });
                const r = data.data || data.result || data.BK9 || data;
                vUrl = r.hd || r.sd || r.video || r.HD || r.download;
                if (vUrl) break;
            } catch {}
        }
        if (!vUrl) return await socket.sendMessage(sender, { text: "❌ FB download failed. Link may be private." }, { quoted: msg });
        await socket.sendMessage(sender, { video: { url: vUrl }, caption: "📘 FB Video\n> ALEXA-MIN" }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ ${e.message}` }, { quoted: msg }); }
    break;
}

case 'tt': case 'tik': case 'ttdl': {
    const axios = require('axios');
    try {
        const link = args[0] || q;
        if (!link ||!link.includes('tiktok')) return await socket.sendMessage(sender, { text: `📌.tt <tiktok link>` }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        let vUrl = null;
        const apis = [
            `https://www.tikwm.com/api/?url=${encodeURIComponent(link)}&hd=1`,
            `https://api.vreden.my.id/api/tiktok?url=${encodeURIComponent(link)}`,
            `https://api.davidcyriltech.my.id/tiktok?url=${encodeURIComponent(link)}`
        ];
        for (const api of apis) {
            try {
                const { data } = await axios.get(api, { timeout: 20000 });
                vUrl = data?.data?.play || data?.data?.hdplay || data?.data?.data?.play || data?.video?.noWatermark || data?.result?.video;
                if (vUrl) break;
            } catch {}
        }
        if (!vUrl) return await socket.sendMessage(sender, { text: "❌ TikTok failed" }, { quoted: msg });
        await socket.sendMessage(sender, { video: { url: vUrl }, caption: "🎵 TikTok No Watermark\n> ALEXA-MIN" }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ ${e.message}` }, { quoted: msg }); }
    break;
}

case 'mediafire': case 'mf': {
    const axios = require('axios');
    try {
        const link = args[0] || q;
        if (!link ||!link.includes('mediafire')) return await socket.sendMessage(sender, { text: `📌.mf <mediafire link>` }, { quoted: msg });

        const { data } = await axios.get(`https://api.vreden.my.id/api/mediafire?url=${encodeURIComponent(link)}`, { timeout: 20000 });
        const r = data.result || data.data || data;
        const dl = r.link || r.url || r.download;

        if (!dl) return await socket.sendMessage(sender, { text: "❌ Mediafire failed" }, { quoted: msg });

        await socket.sendMessage(sender, {
            document: { url: dl },
            mimetype: r.mimetype || 'application/octet-stream',
            fileName: r.filename || r.name || 'file',
            caption: `*📦 ${r.filename || 'Mediafire File'}*\n*Size:* ${r.size || '--'}\n> ALEXA-MIN`
        }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ Mediafire error: ${e.message}` }, { quoted: msg }); }
    break;
}

case 'spotify': case 'sp': case 'spdl': {
    const axios = require('axios');
    try {
        const link = args[0] || q;
        if (!link) return await socket.sendMessage(sender, { text: `📌.spotify <spotify link or song name>` }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '🎧', key: msg.key } });

        let audioUrl, title, cover, artist;

        // If it's a Spotify URL
        if (link.includes('spotify.com')) {
            const apis = [
                `https://api.vreden.my.id/api/spotify?url=${encodeURIComponent(link)}`,
                `https://api.davidcyriltech.my.id/download/spotify?url=${encodeURIComponent(link)}`
            ];
            for (const api of apis) {
                try {
                    const { data } = await axios.get(api, { timeout: 20000 });
                    const r = data.result || data.data || data;
                    audioUrl = r.download || r.url || r.link;
                    title = r.title || r.name; artist = r.artists || r.artist; cover = r.image || r.thumbnail;
                    if (audioUrl) break;
                } catch {}
            }
        } else {
            // Search name
            const searchApi = `https://api.vreden.my.id/api/spotifysearch?query=${encodeURIComponent(link)}`;
            const { data } = await axios.get(searchApi, { timeout: 15000 });
            const first = data.result?.[0] || data.data?.[0];
            if (first) {
                title = first.title; artist = first.artist; cover = first.image;
                // Now get dl link
                const dlApi = `https://api.vreden.my.id/api/spotify?url=${encodeURIComponent(first.url || first.link)}`;
                const dl = await axios.get(dlApi, { timeout: 20000 });
                audioUrl = dl.data.result?.download || dl.data.data?.download;
            }
        }

        if (!audioUrl) return await socket.sendMessage(sender, { text: "❌ Spotify download failed. Try direct link." }, { quoted: msg });

        await socket.sendMessage(sender, {
            image: { url: cover || "https://files.catbox.moe/2q6j6k.jpg" },
            caption: `*🎵 SPOTIFY DL*\n\n*Title:* ${title}\n*Artist:* ${artist}\n\n> Sending...`
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            audio: { url: audioUrl },
            mimetype: 'audio/mpeg',
            fileName: `${title||'spotify'}.mp3`
        }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ Spotify: ${e.message}` }, { quoted: msg }); }
    break;
}

case 'gdrive': case 'drive': {
    const axios = require('axios');
    try {
        const link = args[0] || q;
        if (!link ||!link.includes('drive.google')) return await socket.sendMessage(sender, { text: `📌.gdrive <google drive link>` }, { quoted: msg });

        const { data } = await axios.get(`https://api.vreden.my.id/api/gdrive?url=${encodeURIComponent(link)}`, { timeout: 20000 });
        const r = data.result || data.data;

        if (!r?.download) return await socket.sendMessage(sender, { text: "❌ GDrive failed - make sure link is public" }, { quoted: msg });

        await socket.sendMessage(sender, {
            document: { url: r.download },
            mimetype: r.mimetype || 'application/octet-stream',
            fileName: r.fileName || 'gdrive_file',
            caption: `*📁 ${r.fileName}*\n*Size:* ${r.fileSize}\n> ALEXA-MIN`
        }, { quoted: msg });

    } catch (e) { await socket.sendMessage(sender, { text: `❌ GDrive: ${e.message}` }, { quoted: msg }); }
    break;
}
case 'video':
case 'ytvideo': {
    try {
        if (!args.length) {
            await socket.sendMessage(sender, {
                text: `📌 *Usage:* ${userConfig.PREFIX}video <song/video name>`
            }, { quoted: msg });
            break;
        }

        const query = args.join(' ');

        await socket.sendMessage(sender, {
            text: `🔎 *Searching video...*\n\n🎬 ${query}`
        }, { quoted: msg });

        const search = await yts(query);

        if (!search?.videos?.length) {
            await socket.sendMessage(sender, {
                text: '❌ *Video not found.*'
            }, { quoted: msg });
            break;
        }

        const video = search.videos[0];

        await socket.sendMessage(sender, {
            image: { url: video.thumbnail },
            caption:
`🎬 *${video.title}*

👤 *Channel:* ${video.author?.name || 'Unknown'}
⏱️ *Duration:* ${video.timestamp || 'Unknown'}

⏳ *Preparing video...*`
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            text: `🔗 *YouTube URL:*\n${video.url}\n\n⚠️ *Your MP4 API endpoint is required to download the actual video.*`
        }, { quoted: msg });

    } catch (error) {
        console.error('VIDEO ERROR:', error);

        await socket.sendMessage(sender, {
            text: `❌ *Video Error:*\n${error.message || 'Something went wrong.'}`
        }, { quoted: msg });
    }

    break;
}
case 'video': {
    try {
        // Make absolutely sure query is a STRING
        const query = Array.isArray(args)
            ? args.join(' ').trim()
            : String(args || '').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text:
`❌ *Please enter a video name.*

📌 *Example:*
${config?.PREFIX || '.'}video chill`
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text:
`🔎 *Searching video...*

🎬 ${query}`
        }, { quoted: msg });

        // Load yt-search safely
        const ytSearch = require('yt-search');

        // Make sure the imported module is callable
        const searchFunction =
            typeof ytSearch === 'function'
                ? ytSearch
                : ytSearch.default;

        if (typeof searchFunction !== 'function') {
            throw new Error(
                'yt-search is not loaded correctly. Run: npm install yt-search'
            );
        }

        // Search YouTube
        const search = await searchFunction(String(query));

        if (!search || !Array.isArray(search.videos) || !search.videos.length) {
            return await socket.sendMessage(sender, {
                text: `❌ *No videos found for:* ${query}`
            }, { quoted: msg });
        }

        const video = search.videos[0];

        if (!video || !video.url) {
            throw new Error('YouTube search returned an invalid video.');
        }

        // SAFELY convert title to string
        const title = String(video.title || 'YouTube Video');

        const cleanTitle = title
            .replace(/[\\/:*?"<>|]/g, '')
            .trim()
            .slice(0, 100) || 'youtube-video';

        const channel = String(
            video.author?.name || 'Unknown'
        );

        const duration = String(
            video.timestamp || 'Unknown'
        );

        const views =
            typeof video.views === 'number'
                ? video.views.toLocaleString()
                : String(video.views || 'Unknown');

        const caption =
`🎬 *YOUTUBE VIDEO*

📌 *Title:* ${title}
👤 *Channel:* ${channel}
⏱️ *Duration:* ${duration}
👁️ *Views:* ${views}

🔗 ${video.url}

⏳ *Downloading video...*`;

        // Send thumbnail first
        if (video.thumbnail) {
            await socket.sendMessage(sender, {
                image: {
                    url: video.thumbnail
                },
                caption: caption
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: caption
            }, { quoted: msg });
        }

        // =========================
        // YOUTUBE MP4 API
        // =========================

        const apiUrl =
            `https://eliteprotech-apis.zone.id/ytmp4?url=${encodeURIComponent(video.url)}`;

        console.log('YTMP4 REQUEST:', apiUrl);

        const response = await axios.get(apiUrl, {
            timeout: 120000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        console.log(
            'YTMP4 RESPONSE:',
            JSON.stringify(response.data, null, 2)
        );

        const body = response.data;

        // Handle different API response formats
        let downloadUrl = null;

        if (typeof body === 'string') {
            downloadUrl = body;
        }

        if (!downloadUrl && body?.url) {
            downloadUrl = body.url;
        }

        if (!downloadUrl && body?.download) {
            downloadUrl =
                typeof body.download === 'string'
                    ? body.download
                    : body.download?.url ||
                      body.download?.downloadUrl;
        }

        if (!downloadUrl && body?.result) {
            downloadUrl =
                typeof body.result === 'string'
                    ? body.result
                    : body.result?.url ||
                      body.result?.downloadUrl ||
                      body.result?.download_url ||
                      body.result?.videoUrl;
        }

        if (!downloadUrl && body?.data) {
            downloadUrl =
                typeof body.data === 'string'
                    ? body.data
                    : body.data?.url ||
                      body.data?.downloadUrl ||
                      body.data?.download_url ||
                      body.data?.videoUrl;
        }

        if (
            !downloadUrl ||
            typeof downloadUrl !== 'string' ||
            !/^https?:\/\//i.test(downloadUrl)
        ) {
            console.error(
                'INVALID YTMP4 RESPONSE:',
                body
            );

            throw new Error(
                'YTMP4 API did not return a valid video download URL.'
            );
        }

        console.log(
            'YTMP4 DOWNLOAD URL:',
            downloadUrl
        );

        // =========================
        // SEND VIDEO
        // =========================

        await socket.sendMessage(sender, {
            video: {
                url: downloadUrl
            },
            mimetype: 'video/mp4',
            fileName: `${cleanTitle}.mp4`,
            caption:
`🎬 *${title}*

✅ *VIDEO DOWNLOADED*

> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: '✅',
                key: msg.key
            }
        });

    } catch (error) {
        console.error(
            'VIDEO ERROR:',
            error.stack || error
        );

        await socket.sendMessage(sender, {
            text:
`❌ *Video Error:*

${error.message || 'Something went wrong.'}`
        }, { quoted: msg });
    }

    break;
}

// Case: pair  
case 'pair':  
case 'connect': {  
    await socket.sendMessage(sender, { react: { text: '📲', key: msg.key } });  

    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));  
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));  

    // YOUR NEW REPO
    const RAW_URL = "https://raw.githubusercontent.com/watson-dev1/watson-session/main/url.json";  
    const FALLBACK_URL = "https://preciousminbot.up.railway.app";

    let UrlOP = FALLBACK_URL;
    try {  
        const res = await fetch(RAW_URL);  
        if(res.ok){
            const data = await res.json();  
            UrlOP = data.UrlOP || FALLBACK_URL;
        }
    } catch (err) {  
        console.log("Using fallback:", FALLBACK_URL);
    }  

    UrlOP = UrlOP.replace(/\/pair\/?$/i, '').replace(/\/$/, '');

    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';  
    let number = q.replace(/^[.\/!]?(pair|connect)\s*/i, '').trim().replace(/[^0-9]/g, '');  

    if (!number) {  
        return await socket.sendMessage(sender, { text: '*📌 ᴜsᴀɢᴇ:* .pair 263785123456' }, { quoted: msg });  
    }  

    const fakevCard = {
        key: { fromMe: false, participant: "0@s.whatsapp.net", remoteJid: "status@broadcast" },
        message: { contactMessage: { displayName: "ALEXA-MIN", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:ALEXA-MIN\nORG:;\nTEL;type=CELL;type=VOICE;waid=${number}:+${number}\nEND:VCARD` } }
    };

    try {  
        const url = `${UrlOP}/code?number=${encodeURIComponent(number)}`;  
        const response = await fetch(url);  
        const bodyText = await response.text();  
        console.log("🌐 API Response:", bodyText);  
        const result = JSON.parse(bodyText);

        if (!result?.code) {  
            return await socket.sendMessage(sender, { text: `❌ Failed. Try: ${UrlOP}/pair` }, { quoted: msg });  
        }  

        await socket.sendMessage(sender, { text: `> *alexa mini bot pair completed* ✅\n\n*🔑 CODE:* ${result.code}\n\n1. WhatsApp > Linked Devices > Link with phone number\n2. Enter ${result.code} FAST\n\nAfter link, DM will get creds.json\n\n*Site:* ${UrlOP}/pair` }, { quoted: msg });  
        await sleep(1500);  
        await socket.sendMessage(sender, { text: `${result.code}` }, { quoted: fakevCard });  

    } catch (err) {  
        console.error("❌ Pair Error:", err);  
        await socket.sendMessage(sender, { text: `❌ Error. Direct: ${FALLBACK_URL}/pair` }, { quoted: msg });  
    }  
    break;  
}

// Case: song
case 'stats':
case 'status': {
    try {
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        
        // Format time beautifully (e.g., "1h 5m 3s" or "5m 3s" if hours=0)
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        let formattedTime = '';
        if (hours > 0) formattedTime += `${hours}h `;
        if (minutes > 0 || hours > 0) formattedTime += `${minutes}m `;
        formattedTime += `${seconds}s`;

        // Get memory usage (optional)
        const memoryUsage = (process.memoryUsage().rss / (1024 * 1024)).toFixed(2) + " MB";

        await socket.sendMessage(sender, {
            image: { url: config.IK_IMAGE_PATH },
            caption: formatMessage(
                '🌟 BOT RUNTIME STATS',
                `⏳ *Uptime:* ${formattedTime}\n` +
                `👥 *Active Sessions:* ${activeSockets.size}\n` +
                `📱 *Your Number:* ${number}\n` +
                `💾 *Memory Usage:* ${memoryUsage}\n\n` +
                `> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`,
                'ALEXA-MIN'
            ),
            contextInfo: { forwardingScore: 999, isForwarded: true }
        });
    } catch (error) {
        console.error("❌ Runtime command error:", error);
        await socket.sendMessage(sender, { 
            text: "⚠️ Failed to fetch runtime stats. Please try again later."
        });
    }
    break;
}
case 'sc':
case 'script':
case 'repo': {
    try {
        // Fallback if config missing
        const botImage = config?.IK_IMAGE_PATH || config?.IMAGE_PATH || config?.MENU_IMAGE || "https://files.catbox.moe/2q6j6k.jpg";

        const message = `
*⚡ ALEXA-MIN - OFFICIAL ⚡*
────────────────────
📂 *Bot Name:* Alexa-Mini V2
👑 *Owner:* Watson Fourpence
🔧 *Version:* 3.0.0 [Stable]
📅 *Updated:* 2026

*🔗 IMPORTANT LINKS*

📢 *Update Channel:*
https://whatsapp.com/channel/0029VbDTiJkC6Zvm9MZaKs3j

👤 *GitHub:*
https://github.com/watson-dev1

🔗 *Pair Site:*
preciousminbot.up.railway.app

💬 *Support Group:*
https://chat.whatsapp.com/FK2HSe9McfzD8QAFKyLA1W

────────────────────
> *© ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ TEAM*
        `.trim();

        await socket.sendMessage(sender, {
            image: { url: botImage },
            caption: message,
            contextInfo: {
                externalAdReply: {
                    title: "ALEXA-MIN OFFICIAL REPO",
                    body: "Tap to join update channel",
                    thumbnailUrl: botImage,
                    sourceUrl: "https://chat.whatsapp.com/FK2HSe9McfzD8QAFKyLA1W",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: fakevCard });

    } catch (error) {
        console.error("SC Command Error:", error.message);
        // Text fallback if image fails
        await socket.sendMessage(sender, {
            text: `*⚡ ᗩᒪE᙭ᗩ-ᗰIᑎ ⚡*\n\n📂 Repo: No official public repo\n📢 Updates: https://chat.whatsapp.com/FK2HSe9McfzD8QAFKyLA1W\n👤 GitHub: https://github.com/watson-dev1\n🔗 Pair: preciousminbot.up.railway.app\n\n> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`
        }, { quoted: fakevCard });
    }
    break;
}

// ===============================
// 📌 Case savestatus / send / sendme / save
// ===============================
case 'savestatus':                   
case 'send':
case 'sendme':
case 'save': {
    await socket.sendMessage(sender, { react: { text: '📤', key: msg.key } });

    try {
        if (!msg.quoted) {
            return await socket.sendMessage(from, {
                text: "*🍁 ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ!*"
            }, { quoted: fakevCard });
        }

        const buffer = await msg.quoted.download();
        const mtype = msg.quoted.type; // Using .type from msg.js
        const options = { quoted: msg };

        let messageContent = {};
        switch (mtype) {
            case "imageMessage":
                messageContent = {
                    image: buffer,
                    caption: msg.quoted.body || '',
                    mimetype: msg.quoted.msg.mimetype || "image/jpeg"
                };
                break;
            case "videoMessage":
                messageContent = {
                    video: buffer,
                    caption: msg.quoted.body || '',
                    mimetype: msg.quoted.msg.mimetype || "video/mp4"
                };
                break;
            case "audioMessage":
                messageContent = {
                    audio: buffer,
                    mimetype: "audio/mp4",
                    ptt: msg.quoted.msg.ptt || false
                };
                break;
            default:
                return await socket.sendMessage(from, {
                    text: "❌ ᴏɴʟʏ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴀɴᴅ ᴀᴜᴅɪᴏ ᴍᴇssᴀɢᴇs ᴀʀᴇ sᴜᴘᴘᴏʀᴛᴇᴅ"
                }, { quoted: fakevCard });
        }

        await socket.sendMessage(from, messageContent, options);

    } catch (error) {
        console.error("Forward Error:", error);
        await socket.sendMessage(from, {
            text: "❌ Error forwarding message:\n" + error.message
        }, { quoted: fakevCard });
    }

    break;
}

// ===============================
// 📌 Case take / rename / stake
// ===============================
case 'take':
case 'rename':
case 'stake': {
    if (!msg.quoted) {
        return await socket.sendMessage(from, {
            text: "*📛 ʀᴇᴘʟʏ ᴛᴏ ᴀɴʏ sᴛɪᴄᴋᴇʀ.*"
        }, { quoted: fakevCard });
    }
    if (!args[0]) {
        return await socket.sendMessage(from, {
            text: "*🍁 ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴘᴀᴄᴋ ɴᴀᴍᴇ ᴜsɪɴɢ .ᴛᴀᴋᴇ <ᴘᴀᴄᴋɴᴀᴍᴇ>*"
        }, { quoted: fakevCard });
    }

    try {
        let mime = msg.quoted.type;
        let pack = args.join(" ");

        if (mime === "imageMessage" || mime === "stickerMessage" || mime === "videoMessage") {
            let media = await msg.quoted.download();
            let sticker = new Sticker(media, {
                pack: pack,
                type: StickerTypes.FULL,
                categories: ["🤩", "🎉"],
                id: "12345",
                quality: 75,
                background: 'transparent',
            });
            const buffer = await sticker.toBuffer();
            await socket.sendMessage(from, { sticker: buffer }, { quoted: msg });
        } else {
            return await socket.sendMessage(from, {
                text: "*❌ ᴜʜʜ, ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ sᴛɪᴄᴋᴇʀ.*"
            }, { quoted: fakevCard });
        }
    } catch (e) {
        console.error("❌ Take error:", e);
        await socket.sendMessage(from, {
            text: "❌ Failed to create sticker."
        }, { quoted: fakevCard });
    }
    break;
}

// ===============================
// 📌 Case sticker / s / stickergif
// ===============================
case 'sticker':
case 's':
case 'stickergif': {
    if (!msg.quoted) {
        return await socket.sendMessage(from, {
            text: "*📛 ʀᴇᴘʟʏ ᴛᴏ ᴀɴʏ ɪᴍᴀɢᴇ ᴏʀ ᴠɪᴅᴇᴏ.*"
        }, { quoted: fakevCard });
    }

    try {
        let mime = msg.quoted.type;
        let pack = "Sɪɢᴍᴀ ᴍɪɴɪ ʙᴏᴛ";

        // Check for supported media types
        if (mime === "imageMessage" || mime === "videoMessage" || mime === "stickerMessage") {
            let media = await msg.quoted.download();
            let sticker = new Sticker(media, {
                pack: pack,
                type: StickerTypes.FULL,
                categories: ["🤩", "🎉"],
                id: "12345",
                quality: 75,
                background: 'transparent',
            });
            const buffer = await sticker.toBuffer();
            await socket.sendMessage(from, { sticker: buffer }, { quoted: msg });
        } else {
            return await socket.sendMessage(from, {
                text: `*❌ ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴍᴇᴅɪᴀ ᴛʏᴘᴇ: ${mime}. ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ sᴛɪᴄᴋᴇʀ.*`
            }, { quoted: fakevCard });
        }
    } catch (e) {
        console.error("❌ Sticker error:", e);
        await socket.sendMessage(from, {
            text: "❌ Failed to create sticker. Please try again with a different media."
        }, { quoted: fakevCard });
    }
    break;
}
//THIS ERROR FIXD BY ROMEK XD
// ===============================
// 📌 Case vv (view once)
// ===============================
case 'vv': {
    await socket.sendMessage(sender, { react: { text: '⚠️', key: msg.key } });

    if (!isOwner) {
        await socket.sendMessage(from, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: fakevCard });
        break;
    }

    // Check if reply
    if (!msg.quoted) {
        await socket.sendMessage(from, { text: "*🍁 ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ!*" }, { quoted: fakevCard });
        break;
    }

    try {
        let q = msg.quoted;
        let buffer = await q.download();
        let mtype = q.type;
        let options = { quoted: msg };

        let content = {};
        if (mtype === "imageMessage") {
            content = { image: buffer, caption: q.body || '' };
        } else if (mtype === "videoMessage") {
            content = { video: buffer, caption: q.body || '' };
        } else if (mtype === "audioMessage") {
            content = { audio: buffer, mimetype: "audio/mp4", ptt: q.msg.ptt || false };
        } else {
            await socket.sendMessage(from, { text: "❌ ᴏɴʟʏ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴀɴᴅ ᴀᴜᴅɪᴏ sᴜᴘᴘᴏʀᴛᴇᴅ." }, { quoted: msg });
            break;
        }

        await socket.sendMessage(from, content, options);

    } catch (e) {
        console.error("VV Error:", e);
        await socket.sendMessage(from, { text: "❌ Error fetching message:\n" + e.message }, { quoted: fakevCard });
    }
    break;
}

case 'ping':
case 'speed':
case 'pong': {
    try {
        await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

        const start = Date.now();

        // Real ping test - send and edit
        const { key } = await socket.sendMessage(sender, { text: '*⚡ ᴛᴇꜱᴛɪɴɢ ꜱᴘᴇᴇᴅ...*' }, { quoted: msg });

        const latency = Date.now() - start;
        const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const uptime = Math.floor(process.uptime() / 60);

        const emojis = ['🚀','⚡','🔥','✨','💨','🎯'];
        const e = emojis[Math.floor(Math.random()*emojis.length)];

        const txt = `
*⚡ 𝐀𝐋𝐄𝐗𝐀-𝐌𝐈𝐍 𝐒𝐏𝐄𝐄𝐃 𝐓𝐄𝐒𝐓 ${e}*

🚀 *Speed:* ${latency} ms
📡 *Latency:* ${latency < 300? 'Excellent 🟢' : latency < 600? 'Good 🟡' : 'Slow 🔴'}
⏱️ *Uptime:* ${uptime} mins
💾 *RAM:* ${ram} MB
👑 *Status:* Online ✅

> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ
        `.trim();

        await socket.sendMessage(sender, { text: txt, edit: key }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, { text: `> *alexa min speed : ${Date.now() - new Date().getTime()} ms*` }, { quoted: msg });
    }
    break;
}
        case 'deleteme':
case 'delsession':
case 'logout': {
    const fs = require('fs-extra');
    const path = require('path');
    try {
        // Get number from pair file or sender
        const q = getText(msg).replace(/^[.\/!]deleteme\s*/i, '').trim();
        let number = q || sender.split('@')[0];
        number = number.replace(/[^0-9]/g, '');

        if (!number) return await socket.sendMessage(sender, { text: "❌ Provide number:.deleteme 2637xxxxxxx" }, { quoted: msg });

        await socket.sendMessage(sender, { text: `🗑️ *Deleting session for ${number}...*` }, { quoted: msg });

        // 1. Delete local session
        const SESSION_BASE_PATH = path.join(__dirname, '../sessions'); // CHANGE THIS TO YOUR PATH
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${number}`);

        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
            console.log(`Deleted local: ${sessionPath}`);
        }

        // 2. Delete from GitHub if you use that function
        if (typeof deleteSessionFromGitHub === 'function') {
            await deleteSessionFromGitHub(number).catch(()=>{});
        }

        // 3. Close active socket
        if (typeof activeSockets!== 'undefined' && activeSockets.has(number)) {
            try { activeSockets.get(number).ws.close(); } catch {}
            activeSockets.delete(number);
            if(typeof socketCreationTime!== 'undefined') socketCreationTime.delete(number);
        }

        await socket.sendMessage(sender, {
            image: { url: config?.IK_IMAGE_PATH || "https://files.catbox.moe/2q6j6k.jpg" },
            caption: `*🗑️ SESSION DELETED*\n\n✅ Number: ${number}\n✅ Local files cleared\n✅ Socket closed\n\n> ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`
        }, { quoted: msg });

    } catch (err) {
        console.error("DeleteMe error:", err);
        await socket.sendMessage(sender, { text: `❌ Delete failed: ${err.message}` }, { quoted: msg });
    }
    break;
}
                
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.IK_IMAGE_PATH },
                caption: formatMessage(
'⚡ Upgrade Your Experience',
`Looking for more stability and features?

🚀 ALEXA-MIN OFFERS:
• Enhanced AI capabilities
• Advanced media tools
• Fewer errors
• Faster responses

- ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ`
)
            });
        }
    });
}

//THIS ERROR FIXD BY ROMEK XD

function setupMessageHandlers(socket, userConfig) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (userConfig.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });
//THIS ERROR FIXD BY ROMEK XD
        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const userConfig = JSON.parse(content);
        
        // Merge with default settings to ensure all fields exist
        return { ...config.DEFAULT_SETTINGS, ...userConfig };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config.DEFAULT_SETTINGS };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
            console.log(`Connection lost for ${number}, attempting to reconnect...`);
            await delay(10000);
            activeSockets.delete(number.replace(/[^0-9]/g, ''));
            socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
const logger = pino({
    level: process.env.NODE_ENV === 'production'
        ? 'fatal'
        : 'debug'
});

try {

    const socket = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                logger
            ),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Safari')
    });

    // ─────────────────────────────
    // 👥 GROUP WELCOME / GOODBYE
    // ─────────────────────────────

    setupGroupParticipantHandlers(socket);

    socketCreationTime.set(
        sanitizedNumber,
        Date.now()
    );

        // Load user config with proper default handling
        let userConfig;
        try {
            userConfig = await loadUserConfig(sanitizedNumber);
            // Ensure all required settings exist
            userConfig = { ...config.DEFAULT_SETTINGS, ...userConfig };
        } catch (error) {
            userConfig = { ...config.DEFAULT_SETTINGS };
        }

        // Pass userConfig to handlers correctly
        setupStatusHandlers(socket, userConfig);
        setupCommandHandlers(socket, sanitizedNumber, userConfig);
        setupMessageHandlers(socket, userConfig);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        // handleMessageRevocation(socket, sanitizedNumber); // Commented out as it's not defined

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
    await saveCreds();
    try {
        const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
        let sha;
        try {
            const { data } = await octokit.repos.getContent({
                owner: githubOwner, // FIXED - was `owner` which is not defined
                repo,
                path: `session/creds_${sanitizedNumber}.json`
            });
            sha = data.sha;
        } catch (error) {
            // File doesn't exist yet, no sha needed
        }

        await octokit.repos.createOrUpdateFileContents({
            owner: githubOwner, // FIXED - was `owner` which is not defined
            repo,
            path: `session/creds_${sanitizedNumber}.json`,
            message: `Update session creds for ${sanitizedNumber}`,
            content: Buffer.from(fileContent).toString('base64'),
            ...(sha ? { sha } : {})
        });
        console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
    } catch (e) {
        console.log('Failed to update GitHub creds:', e.message);
    }
});

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                        console.log('✅ Auto-followed newsletter');
                    } catch (error) {
                        console.error('❌ Newsletter follow error:', error.message);
                    }

// Update user config after connection
try {
    await updateUserConfig(sanitizedNumber, userConfig);
} catch (error) {
    console.error('Failed to update user config:', error);
    await socket.sendMessage(userJid, {
        text: '⚠️ Failed to update configuration. Please try again.'
    });
    return;
}

activeSockets.set(sanitizedNumber, socket);

// Bot config for consistent branding
const botStatus = {
    version: '1.4.0', // Match other commands
    prefix: config.PREFIX || '!',
    owner: 'watsonx'
};

// Format success message
const successMessage = `*✨ ALEXA-MIN CONNECTION ✨*  
╭══════❖ Connection Status ❖══════╮  
│ ✅ *Status:* Successfully Connected!  
│ 🔢 *Number:* ${sanitizedNumber}  
│ 👑 *Owner:* ${botStatus.owner}  
│ 🛠 *Version:* ${botStatus.version}  
│ 🔑 *Prefix:* ${botStatus.prefix}  
│ 📜 *Welcome:* Your bot is now online! Use ${botStatus.prefix}menu to explore commands.  
╰═════════════════════❖  

💡 *ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ*  
📌 *Type ${botStatus.prefix}help for command details*`;

// Define interactive buttons
const buttons = [
    {
        buttonId: `${botStatus.prefix}menu`,
        buttonText: { displayText: '📋 Menu' },
        type: 1
    },
    {
        buttonId: `${botStatus.prefix}help`,
        buttonText: { displayText: 'ℹ️ Help' },
        type: 1
    },
    {
        buttonId: `${botStatus.prefix}support`,
        buttonText: { displayText: '🤝 Support' },
        type: 1
    }
];

// Send success message with image and buttons
await socket.sendMessage(userJid, {
    image: { url: config.IK_IMAGE_PATH || 'watson-md.jpg' },
    caption: successMessage,
    footer: '⚡ᴀʟᴇxᴀ-ᴍɪɴ | ʏᴏᴜʀ ᴜʟᴛɪᴍᴀᴛᴇ ᴀꜱꜱɪꜱᴛᴀɴᴛ',
    buttons: buttons,
    headerType: 4,
    contextInfo: {
        mentionedJid: [userJid],
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '12036341825232851@newsletter',
            newsletterName: '⚡ ᑭOᗯEᖇEᗪ ᗷY ᗩᒪE᙭ᗩ-ᗰIᑎ ⚡',
            serverMessageId: 143
        },
        externalAdReply: {
            title: 'ᗩᒪE᙭ᗩ-ᗰIᑎ',
            body: 'Your Ultimate WhatsApp Assistant',
            thumbnailUrl: config.IK_IMAGE_PATH || 'watson-md.jpg',
            sourceUrl: 'https://github.com/watson-dev1'
        }
    }
});

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        await updateNumberListOnGitHub(sanitizedNumber);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'session'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }
    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
    }
    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({ count: activeSockets.size, numbers: Array.from(activeSockets.keys()) });
});

router.get('/ping', (req, res) => {
    res.status(200).send({ status: 'active', message: 'ᴀʟᴇxᴀ-ᴍɪɴ ɪꜱ ʀᴜɴɴɪɴɢ', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }
        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }
        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: 'session' });
        const sessionFiles = data.filter(file => file.name.startsWith('creds_') && file.name.endsWith('.json'));
        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }
        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }
            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number ||!configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }
    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }
    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number ||!otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }
    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }
    if (storedData.otp!== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }
    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.IK_IMAGE_PATH },
                caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', '> Powered By: WATSON-XD ❗')
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number ||!target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }
    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt? moment(statusData.setAt).tz('Asia/Karachi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.` });
    }
});

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'session'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const pathOnGitHub = 'session/numbers.json';
    const sanitizedNumber = String(newNumber || '').replace(/[^0-9]/g, '');

    if (!sanitizedNumber) {
        console.error('❌ Cannot update GitHub numbers.json: invalid number');
        return false;
    }

    try {
        let numbers = [];
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: pathOnGitHub,
                ref: 'main'
            });

            if (!data || !data.content) {
                throw new Error('GitHub returned empty numbers.json');
            }

            const content = Buffer
                .from(data.content, 'base64')
                .toString('utf8')
                .trim();

            if (content) {
                try {
                    numbers = JSON.parse(content);
                } catch (parseError) {
                    console.error(
                        '❌ Invalid JSON in GitHub numbers.json:',
                        parseError.message
                    );
                    return false;
                }
            }

            sha = data.sha;

            if (!Array.isArray(numbers)) {
                console.error(
                    '❌ Invalid numbers.json format. Expected an array.'
                );
                return false;
            }

        } catch (error) {
            if (error.status === 404) {
                console.log(
                    '📁 numbers.json does not exist. Creating it...'
                );

                numbers = [];
                sha = undefined;

            } else {
                throw error;
            }
        }

        numbers = numbers
            .map(number => String(number).replace(/[^0-9]/g, ''))
            .filter(Boolean);

        if (numbers.includes(sanitizedNumber)) {
            console.log(
                `ℹ️ ${sanitizedNumber} already exists in GitHub numbers.json`
            );
            return true;
        }

        numbers.push(sanitizedNumber);

        const fileData = {
            owner,
            repo,
            path: pathOnGitHub,
            message: `Add ${sanitizedNumber} to numbers list`,
            content: Buffer
                .from(JSON.stringify(numbers, null, 2) + '\n')
                .toString('base64'),
            branch: 'main'
        };

        if (sha) {
            fileData.sha = sha;
        }

        await octokit.repos.createOrUpdateFileContents(fileData);

        console.log(
            `✅ Added ${sanitizedNumber} to GitHub numbers.json`
        );

        return true;

    } catch (error) {
        console.error(
            '❌ Failed to update numbers.json on GitHub:',
            error.message
        );

        if (error.status) {
            console.error(`📌 GitHub status: ${error.status}`);
        }

        return false;
    }
}


let isAutoReconnecting = false;

async function autoReconnectFromGitHub() {
    const pathOnGitHub = 'session/numbers.json';

    if (isAutoReconnecting) {
        console.log(
            '⏳ GitHub auto-reconnect is already running...'
        );
        return;
    }

    isAutoReconnecting = true;

    try {
        const url =
            `https://raw.githubusercontent.com/` +
            `${owner}/${repo}/main/${pathOnGitHub}`;

        console.log(
            `🔄 Loading WhatsApp numbers from GitHub...`
        );

        const response = await axios.get(url, {
            timeout: 15000,
            responseType: 'json',
            headers: {
                'Cache-Control': 'no-cache',
                'User-Agent': 'WATSON-XD-BOT'
            }
        });

        let numbers = response.data;

        if (typeof numbers === 'string') {
            try {
                numbers = JSON.parse(numbers);
            } catch (parseError) {
                console.error(
                    '❌ Failed to parse GitHub numbers.json:',
                    parseError.message
                );
                return;
            }
        }

        if (!Array.isArray(numbers)) {
            console.error(
                '❌ Invalid numbers format from GitHub.'
            );
            console.error(
                'Expected an array but received:',
                typeof numbers
            );
            return;
        }

        const cleanNumbers = [
            ...new Set(
                numbers
                    .map(number =>
                        String(number || '')
                            .replace(/[^0-9]/g, '')
                    )
                    .filter(Boolean)
            )
        ];

        if (!cleanNumbers.length) {
            console.log(
                'ℹ️ No WhatsApp numbers found in GitHub numbers.json'
            );
            return;
        }

        console.log(
            `📱 Found ${cleanNumbers.length} number(s) on GitHub`
        );

        let reconnected = 0;
        let alreadyConnected = 0;
        let failed = 0;

        for (const number of cleanNumbers) {
            try {
                if (activeSockets.has(number)) {
                    alreadyConnected++;

                    console.log(
                        `✅ Already connected: ${number}`
                    );

                    continue;
                }

                console.log(
                    `🔄 Reconnecting: ${number}`
                );

                const mockRes = {
                    headersSent: false,

                    send: () => {},

                    status: function () {
                        return this;
                    }
                };

                await EmpirePair(number, mockRes);

                reconnected++;

                console.log(
                    `🔁 Reconnected from GitHub: ${number}`
                );

                await delay(1500);

            } catch (numberError) {
                failed++;

                console.error(
                    `❌ Failed to reconnect ${number}:`,
                    numberError.message
                );
            }
        }

        console.log('====================================');
        console.log('✅ GITHUB AUTO-RECONNECT COMPLETE');
        console.log('====================================');
        console.log(`📱 Total numbers: ${cleanNumbers.length}`);
        console.log(`🔁 Reconnected: ${reconnected}`);
        console.log(`✅ Already connected: ${alreadyConnected}`);
        console.log(`❌ Failed: ${failed}`);
        console.log('====================================');

    } catch (error) {

        if (
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNABORTED' ||
            error.code === 'ETIMEDOUT'
        ) {
            console.error(
                '❌ Network error connecting to GitHub:',
                error.message
            );

        } else if (error.response?.status === 404) {
            console.error(
                `❌ File not found on GitHub: ${pathOnGitHub}`
            );

        } else if (
            error.response?.status === 401 ||
            error.response?.status === 403
        ) {
            console.error(
                '❌ GitHub access denied.'
            );

        } else {
            console.error(
                '❌ autoReconnectFromGitHub error:',
                error.message
            );
        }

    } finally {
        isAutoReconnecting = false;
    }
}


async function loadNewsletterJIDsFromRaw() {
    const newsletterUrl =
        'https://raw.githubusercontent.com/watson-dev1/watson-session/main/DB/newsletter.json';

    try {
        const response = await axios.get(newsletterUrl, {
            timeout: 15000,
            responseType: 'json',
            headers: {
                'Cache-Control': 'no-cache',
                'User-Agent': 'ALEXA-MIN'
            }
        });

        if (!response.data) {
            console.error(
                '❌ Empty response from newsletter API'
            );
            return [];
        }

        let data = response.data;

        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (parseError) {
                console.error(
                    '❌ Invalid newsletter JSON:',
                    parseError.message
                );
                return [];
            }
        }

        if (!Array.isArray(data)) {
            console.error(
                '❌ Invalid newsletter data format:',
                typeof data
            );
            return [];
        }

        return data;

    } catch (error) {

        if (
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNABORTED' ||
            error.code === 'ETIMEDOUT'
        ) {
            console.error(
                '❌ Cannot reach GitHub raw content server:',
                error.message
            );

        } else if (error.response?.status === 404) {
            console.error(
                '❌ Newsletter file not found on GitHub'
            );

        } else {
            console.error(
                '❌ Failed to load newsletter list from GitHub:',
                error.message
            );
        }

        return [];
    }
}


setInterval(
    () => {
        autoReconnectFromGitHub().catch(error => {
            console.error(
                '❌ Scheduled GitHub reconnect error:',
                error.message
            );
        });
    },
    5 * 60 * 1000
);


autoReconnectFromGitHub().catch(error => {
    console.error(
        '❌ Initial GitHub reconnect error:',
        error.message
    );
});


module.exports = router;