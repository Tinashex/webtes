const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const { Sticker, createSticker, StickerTypes } = require("wa-sticker-formatter");
const webp = require('node-webpmux');
const crypto = require('crypto');
const axios = require('axios');
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
    AUTO_LIKE_EMOJI: ['❤️', '💚', '🌚', '😍', '💀', '🧡', '💛', '💙', '👻', '🖤', '🤍', '🥀'],
    REACTXEMOJIS: ['😂', '❤️', '🔥', '👏', '😮', '😢', '🤣', '👍', '🎉', '🤔', '🙏', '😍', '😊', '🥰', '💕', '🤩', '✨', '😎', '🥳', '🙌'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    ADMIN_LIST_PATH: './admin.json',
    IK_IMAGE_PATH: './watson-md.jpg',
    NEWSLETTER_JID: '120363418252392851@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '263781330745',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbB0E2MBvvsiMnWBM72n',
    DEFAULT_SETTINGS: {
        AUTO_VIEW_STATUS: 'true',
        AUTO_LIKE_STATUS: 'true',
        AUTO_RECORDING: 'false',
        AUTO_REACT: 'false',
        ANTI_LINK: 'true',
        MODE: 'public',
        PREFIX: '.',
        AUTO_LIKE_EMOJI: ['❤️', '💚', '🌚', '😍', '💀', '🧡', '💛', '💙', '👻', '🖤', '🤍', '🥀'],
        REACTXEMOJIS: ['😂', '❤️', '🔥', '👏', '😮', '😢', '🤣', '👍', '🎉', '🤔', '🙏', '😍', '😊', '🥰', '💕', '🤩', '✨', '😎', '🥳', '🙌'],
    }
};

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN || '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' });
const owner = 'watsonx';
const repo = 'DATA';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getPakistanTimestamp() {
    return moment().tz('Africa/Harare').format('YYYY-MM-DD HH:mm:ss');
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

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'ALEXA-MIN'
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
        if (!message?.key || message.key.remoteJid!== config.NEWSLETTER_JID) return;
        try {
            const emojis = ['❤️', '💚', '👍', '🗿', '💀'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;
            if (!messageId) {
                console.warn('No valid ServerId found:', message);
                return;
            }
            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(
                        config.NEWSLETTER_JID,
                        messageId.toString(),
                        randomEmoji
                    );
                    console.log(`Reacted to newsletter message ${messageId} with ${randomEmoji}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to react to newsletter message ${messageId}, retries left: ${retries}`, error.message);
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('Newsletter reaction error:', error);
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
            const reactions = ["💸", "🇿🇼", "🦢", "✔️", "👌",🤍"🏊‍♀️", "😎", "❤️"];
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
                    const settingsText = `> *ALEXA-MIN Sᴇᴛᴛɪɴɢs* ⚙️\n\n🔹 *Aᴜᴛᴏ Vɪᴇᴡ Sᴛᴀᴛᴜs:* ${userConfig.AUTO_VIEW_STATUS}\n🔹 *Aᴜᴛᴏ Lɪᴋᴇ Sᴛᴀᴛᴜs:* ${userConfig.AUTO_LIKE_STATUS}\n🔹 *Aᴜᴛᴏ Rᴇᴄᴏʀᴅɪɴɢ:* ${userConfig.AUTO_RECORDING}\n🔹 *Aᴜᴛᴏ Rᴇᴀᴄᴛ:* ${userConfig.AUTO_REACT}\n🔹 *Aɴᴛɪ Lɪɴᴋ:* ${userConfig.ANTI_LINK}\n🔹 *Bᴏᴛ Mᴏᴅᴇ:* ${userConfig.MODE}\n🔹 *Pʀᴇғɪx:* ${userConfig.PREFIX}\n\n📋 *Aᴠᴀɪʟᴀʙʟᴇ Cᴏᴍᴍᴀɴᴅs:*\n\n• ${userConfig.PREFIX}statusview on/off\n• ${userConfig.PREFIX}statuslike on/off\n• ${userConfig.PREFIX}recording on/off\n• ${userConfig.PREFIX}autoreact on/off\n• ${userConfig.PREFIX}antilink on/off\n• ${userConfig.PREFIX}mode public/private/inbox\n• ${userConfig.PREFIX}prefix <new_prefix>\n\n> POWERED BY ALEXA-MIN`;
                    await socket.sendMessage(sender, {
                        image: { url: config.IK_IMAGE_PATH },
                        caption: settingsText,
                        contextInfo: {
                            mentionedJid: [msg.sender],
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363418252392851@newsletter',
                                newsletterName: 'POWERED BY ALEXA-MIN',
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
                        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
                        break;
                    }
                    if (!args[0]) {
                        return await socket.sendMessage(sender, {
                            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}autoreact on/off\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.AUTO_REACT}`
                        }, { quoted: msg });
                    }
                    const value = args[0].toLowerCase();
                    if (value!== 'on' && value!== 'off') {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Pʟᴇᴀsᴇ ᴜsᴇ:* on ᴏʀ off'
                        }, { quoted: msg });
                    }
                    const newValue = value === 'on'? 'true' : 'false';
                    userConfig.AUTO_REACT = newValue;
                    await updateUserConfig(sanitizedNumber, userConfig);
                    await socket.sendMessage(sender, {
                        text: `✅ *Aᴜᴛᴏ Rᴇᴀᴄᴛ sᴇᴛ ᴛᴏ:* ${newValue}\n\nBot will ${newValue === 'true'? 'now' : 'no longer'} automatically react to messages.`
                    }, { quoted: msg });
                    break;
                }
                case 'antilink':
                case 'linkblock': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
                        break;
                    }
                    if (!args[0]) {
                        return await socket.sendMessage(sender, {
                            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}antilink on/off\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.ANTI_LINK}`
                        }, { quoted: msg });
                    }
                    const value = args[0].toLowerCase();
                    if (value!== 'on' && value!== 'off') {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Pʟᴇᴀsᴇ ᴜsᴇ:* on ᴏʀ off'
                        }, { quoted: msg });
                    }
                    const newValue = value === 'on'? 'true' : 'false';
                    userConfig.ANTI_LINK = newValue;
                    await updateUserConfig(sanitizedNumber, userConfig);
                    await socket.sendMessage(sender, {
                        text: `✅ *Aɴᴛɪ Lɪɴᴋ sᴇᴛ ᴛᴏ:* ${newValue}\n\nWhen ON: Users sending links will be removed from groups.`
                    }, { quoted: msg });
                    break;
                }
case 'recording':
case 'autorecording': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
        break;
    }
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}autorecord on/off\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.AUTO_RECORDING}`
        }, { quoted: msg });
    }
    const value = args[0].toLowerCase();
    if (value!== 'on' && value!== 'off') {
        return await socket.sendMessage(sender, {
            text: '❌ *Pʟᴇᴀsᴇ ᴜsᴇ:* on ᴏʀ off'
        }, { quoted: msg });
    }
    const newValue = value === 'on'? 'true' : 'false';
    userConfig.AUTO_RECORDING = newValue;
    await updateUserConfig(sanitizedNumber, userConfig);
    await socket.sendMessage(sender, {
        text: `✅ *Aᴜᴛᴏ Rᴇᴄᴏʀᴅɪɴɢ sᴇᴛ ᴛᴏ:* ${newValue}`
    }, { quoted: msg });
    break;
}
case 'mod':
case 'mode': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
        break;
    }
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}mode public/private/inbox\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.MODE}`
        }, { quoted: msg });
    }
    const mode = args[0].toLowerCase();
    if (!['public', 'private', 'inbox'].includes(mode)) {
        return await socket.sendMessage(sender, {
            text: '❌ *Aᴠᴀɪʟᴀʙʟᴇ ᴍᴏᴅᴇs:* public, private, inbox'
        }, { quoted: msg });
    }
    userConfig.MODE = mode;
    await updateUserConfig(sanitizedNumber, userConfig);
    const modeDescriptions = {
        public: 'Cᴏᴍᴍᴀɴᴅs ᴡᴏʀᴋ ᴇᴠᴇʀʏᴡʜᴇʀᴇ',
        private: 'Oɴʟʏ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅs ᴡᴏʀᴋ',
        inbox: 'Cᴏᴍᴍᴀɴᴅs ᴡᴏʀᴋ ᴏɴʟʏ ɪɴ ᴘʀɪᴠᴀᴛᴇ ᴄʜᴀᴛs'
    };
    await socket.sendMessage(sender, {
        text: `✅ *Bᴏᴛ ᴍᴏᴅᴇ sᴇᴛ ᴛᴏ:* ${mode}\n📝 *Dᴇsᴄʀɪᴘᴛɪᴏɴ:* ${modeDescriptions[mode]}`
    }, { quoted: msg });
    break;
}
case 'prefix': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: "*📛 ᴛʜɪs ɪs ᴀɴ ᴏᴡɴᴇʀ ᴄᴏᴍᴍᴀɴᴅ.*" }, { quoted: msg });
        break;
    }
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `📌 *Usᴀɢᴇ:* ${userConfig.PREFIX}prefix <new_prefix>\n*Cᴜʀʀᴇɴᴛ:* ${userConfig.PREFIX}`
        }, { quoted: msg });
    }
    const newPrefix = args[0];
    if (newPrefix.length > 2) {
        return await socket.sendMessage(sender, {
            text: '❌ *Pʀᴇғɪx ᴍᴜsᴛ ʙᴇ 1-2 ᴄʜᴀʀᴀᴄᴛᴇʀs ᴍᴀx*'
        }, { quoted: msg });
    }
    userConfig.PREFIX = newPrefix;
    await updateUserConfig(sanitizedNumber, userConfig);
    await socket.sendMessage(sender, {
        text: `✅ *Pʀᴇғɪx ᴄʜᴀɴɢᴇᴅ ᴛᴏ:* ${newPrefix}\n\n*Exᴀᴍᴘʟᴇ:* ${newPrefix}menu`
    }, { quoted: msg });
    break;
}
case 'uptime':
case 'runtime':
case 'alive': {
    try {
        const lastAliveCall = socket.lastAliveCall?.get(number) || 0;
        if (Date.now() - lastAliveCall < 5000) {
            await socket.sendMessage(sender, { text: '⏳ Please wait 5 seconds before checking status again.' }, { quoted: msg });
            return;
        }
        socket.lastAliveCall = socket.lastAliveCall || new Map();
        socket.lastAliveCall.set(number, Date.now());
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        const runtime = `${hours}h ${minutes}m ${seconds}s`;
        const os = require('os');
        const totalMemory = (os.totalmem() / (1024 ** 3)).toFixed(2);
        const freeMemory = (os.freemem() / (1024 ** 3)).toFixed(2);
        const usedMemory = (totalMemory - freeMemory).toFixed(2);
        const cpuLoad = os.loadavg()[0].toFixed(2);
        const healthStatus = usedMemory / totalMemory < 0.8? '🟢 Excellent' : usedMemory / totalMemory < 0.9? '🟡 Good' : '🔴 Warning';
        const botStatus = {
            version: '1.4.0',
            mode: config.MODE || 'Public',
            status: 'Online',
            prefix: config.PREFIX || '!',
            library: 'Baileys (Multi-Device)',
            owner: 'watson fourpence'
        };
        const now = new Date().toLocaleString("en-US", {
            timeZone: "Asia/Karachi",
            dateStyle: 'short',
            timeStyle: 'medium'
        });
        const aliveText = `*✨ ALEXA MIN  STATUS ✨* \n╭══════❖ System Status ❖══════╮ \n│ 👑 *Owner:* ${botStatus.owner} \n│ 📚 *Library:* ${botStatus.library} \n│ 🛠 *Version:* ${botStatus.version} \n│ 🌍 *Mode:* ${botStatus.mode} \n│ 🔑 *Prefix:* ${botStatus.prefix} \n│ 🟢 *Status:* ${botStatus.status} \n│ ⏰ *Runtime:* ${runtime} \n│ 📅 *Date:* ${now} \n│ 💾 *Memory Usage:* ${usedMemory}GB / ${totalMemory}GB \n│ ⚙️ *CPU Load:* ${cpuLoad} \n│ 🩺 *Health:* ${healthStatus} \n╰═════════════════════❖ \n\n💡 *POWERED BY ALEXA-MIN* \n📌 *Use ${config.PREFIX}menu for all commands*`;
        const buttons = [
            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 },
            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: '🏓 Ping' }, type: 1 },
            { buttonId: `${config.PREFIX}support`, buttonText: { displayText: '🤝 Support' }, type: 1 }
        ];
        await socket.sendMessage(sender, {
            image: { url: config.IK_IMAGE_PATH || 'watson-md.jpg' },
            caption: aliveText,
            footer: '⚡ Alexa Min | Your Ultimate Assistant',
            buttons: buttons,
            headerType: 4,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363418252392851@newsletter',
                    newsletterName: '⚡ ALEXA-MIN ⚡',
                    serverMessageId: 143
                },
                externalAdReply: {
                    title: 'ALEXA-MIN',
                    body: 'Your Ultimate WhatsApp Assistant',
                    thumbnailUrl: config.IK_IMAGE_PATH || 'watson-md.jpg',
                    sourceUrl: 'https://github.com/watson-dev1'
                }
            }
        }, { quoted: msg });
    } catch (error) {
        console.error('Error in alive command:', error);
        await socket.sendMessage(sender, {
            text: '⚠️ Error checking status. Please try again later.'
        }, { quoted: msg });
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
        const lastMenuCall = socket.lastMenuCall?.get(number) || 0;
        if (Date.now() - lastMenuCall < 5000) {
            await socket.sendMessage(sender, { text: '⏳ Please wait 5 seconds before using the menu again.' });
            return;
        }
        socket.lastMenuCall = socket.lastMenuCall || new Map();
        socket.lastMenuCall.set(number, Date.now());
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        const runtime = `${hours}h ${minutes}m ${seconds}s`;
        const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi", dateStyle: 'full', timeStyle: 'medium' });
        const botStatus = { version: '1.4.0', mode: config.MODE || 'Public', status: 'Online', prefix: config.PREFIX || '!', library: 'Baileys (Multi-Device)', owner: 'watsonx' };
        const menuSections = {
            main: [ { cmd: 'alive', desc: 'Check bot status' }, { cmd: 'menu', desc: 'Display this menu' }, { cmd: 'ping', desc: 'Check latency' }, { cmd: 'system', desc: 'System information' }, { cmd: 'owner', desc: 'Owner contact info' }, { cmd: 'jid', desc: 'Get your JID' }, { cmd: 'sc', desc: 'Get source code' }, { cmd: 'stats', desc: 'Bot usage statistics' }, { cmd: 'support', desc: 'Get support group link' } ],
            download: [ { cmd: 'play <song>', desc: 'Play audio from YouTube' }, { cmd: 'video <url/query>', desc: 'Download video' }, { cmd: 'fb <url>', desc: 'Download Facebook video' }, { cmd: 'tt <url>', desc: 'Download TikTok video' }, { cmd: 'ig <url>', desc: 'Download Instagram media' }, { cmd: 'apk <query>', desc: 'Download APK' }, { cmd: 'yts <query>', desc: 'YouTube search' }, { cmd: 'insta-story <username>', desc: 'Download IG stories' } ],
            ai: [ { cmd: 'ai <query>', desc: 'AI assistant' }, { cmd: 'gpt <query>', desc: 'Chat with GPT model' }, { cmd: 'dj <query>', desc: 'AI DJ model' }, { cmd: 'imagine <prompt>', desc: 'Generate AI image' }, { cmd: 'flux <query>', desc: 'Flux AI model' }, { cmd: 'translate <text>', desc: 'Translate text' }, { cmd: 'voice <text>', desc: 'Convert text to speech' } ],
            owner: [ { cmd: 'pair', desc: 'Connect bot' }, { cmd: 'getpp <@user>', desc: 'Get profile picture' }, { cmd: 'alive', desc: 'Check bot status' }, { cmd: 'uptime', desc: 'Check runtime' }, { cmd: 'ping', desc: 'Check speed' }, { cmd: 'boom <text>', desc: 'Repeat message' }, { cmd: 'owner', desc: 'Owner contact' }, { cmd: 'join <link>', desc: 'Join group' }, { cmd: 'save', desc: 'Save status' }, { cmd: 'broadcast <msg>', desc: 'Broadcast message' }, { cmd: 'restart', desc: 'Restart bot (owner-only)' } ],
            group: [ { cmd: 'promote <@user>', desc: 'Promote to admin' }, { cmd: 'demote <@user>', desc: 'Demote from admin' }, { cmd: 'add <number>', desc: 'Add member' }, { cmd: 'invite <number>', desc: 'Send invite link' }, { cmd: 'kick <@user>', desc: 'Remove member' }, { cmd: 'mute', desc: 'Mute group' }, { cmd: 'unmute', desc: 'Unmute group' }, { cmd: 'kickall', desc: 'Remove all members' }, { cmd: 'end', desc: 'Close group' }, { cmd: 'tagall', desc: 'Tag all members' }, { cmd: 'groupinfo', desc: 'Show group details' }, { cmd: 'poll <question> | <option1> | <option2>', desc: 'Create group poll' } ],
            tools: [ { cmd: 'take', desc: 'Rename sticker' }, { cmd: 'sticker', desc: 'Create sticker' }, { cmd: 'fetch <api_url>', desc: 'Fetch API data' }, { cmd: 'npm <package>', desc: 'Check NPM package' }, { cmd: 'image <query>', desc: 'Search images' }, { cmd: 'qr <text>', desc: 'Generate QR code' }, { cmd: 'weather <city>', desc: 'Get weather info' }, { cmd: 'shorturl <url>', desc: 'Shorten URL' } ]
        };
        const totalCommands = Object.values(menuSections).reduce((acc, section) => acc + section.length, 0);
        const generateMenuSection = (title, commands) => {
            let section = `╭═══❖ *${title}* ❖═══╮\n`;
            commands.forEach(({ cmd, desc }) => { section += `│ ➤ ${config.PREFIX}${cmd} : ${desc}\n`; });
            section += `╰═════════════════❖\n\n`;
            return section;
        };
        const requestedSection = args[0]?.toLowerCase();
        let menuText;
        if (requestedSection && menuSections[requestedSection]) {
            menuText = `*✨ ALEXA-MIN ✨*\n\n${generateMenuSection(requestedSection.charAt(0).toUpperCase() + requestedSection.slice(1) + ' Menu', menuSections[requestedSection])}💡 *POWERED BY ALEXA-MIN*`;
        } else {
            menuText = `*✨ ALEXA-MIN ✨* \n╭══════❖ Bot Info ❖══════╮ \n│ 👑 *Owner:* ${botStatus.owner} \n│ 📚 *Library:* ${botStatus.library} \n│ 📅 *Date:* ${now} \n│ ⏰ *Runtime:* ${runtime} \n│ 🔑 *Prefix:* ${botStatus.prefix} \n│ 🌍 *Mode:* ${botStatus.mode} \n│ 🟢 *Status:* ${botStatus.status} \n│ 🛠 *Version:* ${botStatus.version} \n│ 📋 *Commands:* ${totalCommands} \n╰═════════════════════❖ \n\n${generateMenuSection('Main Controls', menuSections.main)}${generateMenuSection('Download Menu', menuSections.download)}${generateMenuSection('AI Menu', menuSections.ai)}${generateMenuSection('Owner Menu', menuSections.owner)}${generateMenuSection('Group Menu', menuSections.group)}${generateMenuSection('Extra Tools', menuSections.tools)}\n💡 *POWERED BY ALEXA-MIN* \n📌 *Use ${config.PREFIX}menu <category> for specific menu* \n📢 *Join our support group:* ${config.PREFIX}support`;
        }
        const buttons = [
            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 Main Menu' }, type: 1 },
            { buttonId: `${config.PREFIX}help`, buttonText: { displayText: 'ℹ️ Help' }, type: 1 },
            { buttonId: `${config.PREFIX}support`, buttonText: { displayText: '🤝 Support' }, type: 1 },
            { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: '👑 Owner' }, type: 1 }
        ];
        await socket.sendMessage(sender, {
            image: { url: config.IK_IMAGE_PATH || 'watson-md.jpg' },
            caption: menuText,
            footer: '⚡ Alexa Min | Your Ultimate Assistant',
            buttons: buttons,
            headerType: 4,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: { newsletterJid: '120363418252392851@newsletter', newsletterName: '⚡ ALEXA-MIN ⚡', serverMessageId: 143 },
                externalAdReply: { title: 'ALEXA-MIN', body: 'Your Ultimate WhatsApp Assistant', thumbnailUrl: config.IK_IMAGE_PATH || 'watson-md.jpg', sourceUrl: 'https://github.com/watson-dev1' }
            }
        });
    } catch (error) {
        console.error('Error generating menu:', error);
        await socket.sendMessage(sender, { text: '⚠️ Error generating menu. Please try again later.' });
    }
    break;
}
 case 'system':
    await socket.sendMessage(sender, {
        image: { url: config.IK_IMAGE_PATH },
        caption: `┏━━【 ✨ALEXA MINI BOT STATUS DASHBOARD 】━━◉\n┃\n┣ 🏓 *PING:* PONG!\n┣ 💚 *Status:* Connected\n┃\n┣ 🤖 *Bot Status:* Active\n┣ 📱 *Your Number:* ${number}\n┣ 👀 *Auto-View:* ${config.AUTO_VIEW_STATUS}\n┣ ❤️ *Auto-Like:* ${config.AUTO_LIKE_STATUS}\n┣ ⏺ *Auto-Recording:* ${config.AUTO_RECORDING}\n┃\n┣ 🔗 *Our Channels:*\n┃ 📱 WhatsApp: https://whatsapp.com/channel/0029VbB0E2MBvvsiMnWBM72n\n┃\n┗━━━━━━━【POWERED BY WATSON-XD】━━━━━━◉`
    });
    break;
            case 'fc': {
    if (args.length === 0) {
        return await socket.sendMessage(sender, {
            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 120363418252392851@newsletter'
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
        teks += "└──✪ ALEXA-MIN ✪──";

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
case 'imagine': {
                  await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                    const axios = require('axios');
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, {
                            text: '🎨 *Give me a spicy prompt to create your AI image, darling 😘*'
                        });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🧠 *Crafting your dreamy image, love...*',
                        });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Oh no, the canvas is blank, babe 💔 Try again later.*'
                            });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *Sɪɢᴍᴀ ᴍɪɴɪ ʙᴏᴛ ᴀɪ ɪᴍᴀɢᴇ*\n\n📌 ᴘʀᴏᴍᴘᴛ: ${prompt}`
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await socket.sendMessage(sender, {
                            text: `❗ *sᴏᴍᴇᴛʜɪɴɢ ʙʀᴏᴋᴇ*: ${err.response?.data?.message || err.message || 'Unknown error'}`
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
*⛩️  ALEXA-MIN  WEATHER REPORT 🌤*

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

> POWERED BY ALEXA-MIN
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

        resultText += `> *© POWERED BY ALEXA-MIN*`;

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
               case 'facebook': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^[.\/!]facebook(dl)?\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '📃 *Usage :* .facebook `<link>`'
        }, { quoted: msg });
    }

    if (!link.includes('facebook.com')) {
        return await socket.sendMessage(sender, {
            text: '*Invalid Facebook link.*'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: '⏳ Downloading video, `please wait...`'
        }, { quoted: msg });

        const apiUrl = `https://api.bk9.dev/download/fb?url=${encodeURIComponent(link)}`;
        const { data } = await axios.get(apiUrl);

        if (!data || !data.BK9) {
            return await socket.sendMessage(sender, {
                text: '*Failed to fetch Fb video.*'
            }, { quoted: msg });
        }

        const result = data.BK9;
        const videoUrl = result.hd || result.sd;
        const quality = result.hd ? "HD ✅" : "SD ⚡";

        if (!videoUrl) {
            return await socket.sendMessage(sender, {
                text: '*No downloadable video found.*'
            }, { quoted: msg });
        }

        const caption = `╭──────────────◆\n` +
                        `📬 *Title:* ${result.title}\n` +
                        `📝 *Description:* ${result.desc || "N/A"}\n` +
                        `🎞 *Quality:* ${quality}\n` +
                        `╰──────────────◆\n\n` +
                        `© POWERED BY ALEXA-MIN`;

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: caption,
            thumbnail: result.thumb ? await axios.get(result.thumb, { responseType: "arraybuffer" }).then(res => Buffer.from(res.data)) : null,
            contextInfo: { mentionedJid: [msg.key.participant || sender] }
        }, { quoted: msg });

    } catch (err) {
        console.error("Fb command error:", err);
        await socket.sendMessage(sender, {
            text: `⚠️ Error occurred:\n${err.message}`
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
            text: `*alexamin 𝐎ᴡɴᴇʀs*\n\n👤 𝐍𝐀𝐌𝐄: ${ownerName}\n📞 𝐍𝐔𝐌𝐁𝐄𝐑: ${ownerNumber}\n\n> POWERED BY ALEXA-MIN`,
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
            text: "📛 *Usage:* `.boom <count> <message>`\n📌 *Example:* `.boom 100 ᴀsᴛʀɪx XD*`"   
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
case 'dj':
case 'meta':
case 'gpt': {
    const axios = require("axios");

    // ✅ Get user input
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || 
              '';

    const query = q.replace(/^[.\/!](ai|dj|meta|gpt)\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, { 
            text: "🤖 *Usage:* .ai <your question>" 
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, { 
            text: "⏳ Thinking... please wait." 
        }, { quoted: msg });

        // ✅ API call
        const apiUrl = `https://apis-keith.vercel.app/ai/gpt41Nano?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl);

        if (!data?.status || !data?.result) {
            return await socket.sendMessage(sender, { 
                text: "❌ No response from AI. Try again later." 
            }, { quoted: msg });
        }

        // ✅ Send AI reply
        await socket.sendMessage(sender, { 
            text: `💡 *AI Reply:*\n\n${data.result}\n\n> *POWERED BY ALEXA-MIN*` 
        }, { quoted: msg });

    } catch (err) {
        console.error("AI Command Error:", err);
        await socket.sendMessage(sender, { 
            text: "❌ AI system down 😢" 
        }, { quoted: msg });
    }

    break;
}

                    case 'tiktok':
                    case 'tt': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^[.\/!]tiktok(dl)?|tt(dl)?\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '📌 *Usage:* .tiktok <link>'
        }, { quoted: msg });
    }

    if (!link.includes('tiktok.com')) {
        return await socket.sendMessage(sender, {
            text: '❌ *Invalid TikTok link.*'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: '⏳ Downloading video, please wait...'
        }, { quoted: msg });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
        const { data } = await axios.get(apiUrl);

        if (!data?.status || !data?.data) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to fetch TikTok video.'
            }, { quoted: msg });
        }

        const { title, like, comment, share, author, meta } = data.data;
        const video = meta.media.find(v => v.type === "video");

        if (!video || !video.org) {
            return await socket.sendMessage(sender, {
                text: '❌ No downloadable video found.'
            }, { quoted: msg });
        }

        const caption = `🎵 *TIKTOK DOWNLOADR*\n\n` +
                        `👤 *User:* ${author.nickname} (@${author.username})\n` +
                        `📖 *Title:* ${title}\n` +
                        `👍 *Likes:* ${like}\n💬 *Comments:* ${comment}\n🔁 *Shares:* ${share}`;

        await socket.sendMessage(sender, {
            video: { url: video.org },
            caption: caption,
            contextInfo: { mentionedJid: [msg.key.participant || sender] }
        }, { quoted: msg });

    } catch (err) {
        console.error("TikTok command error:", err);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred:\n${err.message}`
        }, { quoted: msg });
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
            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}invite +92xxxxx\n\nExample: ${config.PREFIX}invite +98xxxxx`
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
            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}kick +92xxxxx ᴏʀ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ${config.PREFIX}kick`    
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
        await socket.sendMessage(sender, { text: `📌 *Usage:* ${config.PREFIX}promote +92xxxxx or reply with ${config.PREFIX}promote` }, { quoted: fakevCard });
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
        await socket.sendMessage(sender, { text: `📌 *Usage:* ${config.PREFIX}demote +92xxxxx or reply with ${config.PREFIX}demote` }, { quoted: fakevCard });
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



case 'apk': {
    try {
        const appName = args.join(' ').trim();
        if (!appName) {
            await socket.sendMessage(sender, { text: '📌 Usage: .apk <app name>\nExample: .apk whatsapp' }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const apiUrl = `https://api.nexoracle.com/downloader/apk?q=${encodeURIComponent(appName)}&apikey=free_key@maher_apis`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`API request failed with status: ${response.status}`);

        const data = await response.json();
        if (!data || data.status !== 200 || !data.result || typeof data.result !== 'object') {
            await socket.sendMessage(sender, { text: '❌ APK not found.' }, { quoted: fakevCard });
            break;
        }

        const { name, dllink } = data.result;
        if (!name || !dllink) {
            await socket.sendMessage(sender, { text: '❌ Invalid APK data: Missing name or download link.' }, { quoted: fakevCard });
            break;
        }

        // Download APK
        const apkResponse = await fetch(dllink, { headers: { 'Accept': 'application/octet-stream' } });
        if (!apkResponse.ok) throw new Error(`Failed to download APK: Status ${apkResponse.status}`);

        const apkBuffer = Buffer.from(await apkResponse.arrayBuffer());

        // Validate APK file (must start with PK since it's a zip format)
        if (!apkBuffer.slice(0, 2).toString('hex').startsWith('504b')) {
            throw new Error('Downloaded file is not a valid APK');
        }

        await socket.sendMessage(sender, {
            document: apkBuffer,
            mimetype: 'application/vnd.android.package-archive',
            fileName: `${name.replace(/[^a-zA-Z0-9]/g, '_')}.apk`,
            caption: `📦 ${name}\n\nPOWERED BY ALEXA-MIN`
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (error) {
        console.error('APK command error:', error.message);
        await socket.sendMessage(sender, { text: `❌ Failed to fetch APK.\nError: ${error.message}` }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

case 'npm':
case 'npmstalk': {
    try {
        const packageName = args.join(" ").trim();
        if (!packageName) {
            await socket.sendMessage(sender, { text: "❌ Please provide an NPM package name.\n\nExample: .npmstalk express" }, { quoted: fakevCard });
            break;
        }

        const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
        const response = await axios.get(apiUrl);

        if (response.status !== 200) throw new Error("Package not found or an error occurred.");

        const packageData = response.data;
        const latestVersion = packageData["dist-tags"].latest;
        const description = packageData.description || "No description available.";
        const npmUrl = `https://www.npmjs.com/package/${packageName}`;
        const license = packageData.license || "Unknown";
        const repository = packageData.repository ? packageData.repository.url : "Not available";

        const message = `
*ALEXA-MIN - NPM SEARCH*

🔰 *Package:* ${packageName}
📄 *Description:* ${description}
⏸️ *Last Version:* ${latestVersion}
🪪 *License:* ${license}
🪩 *Repository:* ${repository}
🔗 *NPM URL:* ${npmUrl}

POWERED BY ALEXA-MIN
`;

        await socket.sendMessage(sender, { text: message }, { quoted: fakevCard });
    } catch (error) {
        console.error("NPM Command Error:", error.message);
        await socket.sendMessage(sender, { text: `❌ Failed to fetch NPM package.\nError: ${error.message}` }, { quoted: fakevCard });
    }
    break;
}


case 'fetch': {
    try {
        if (!q) {
            await socket.sendMessage(sender, { text: '❌ Please provide a valid URL.\n\nExample: .fetch https://api.github.com/users/github' }, { quoted: fakevCard });
            break;
        }

        if (!/^https?:\/\//.test(q)) {
            await socket.sendMessage(sender, { text: '❌ URL must start with http:// or https://.' }, { quoted: fakevCard });
            break;
        }

        const data = await fetchJson(q);
        const content = JSON.stringify(data, null, 2);

        await socket.sendMessage(sender, {
            text: `🔍 *Fetched Data*:\n\`\`\`${content.slice(0, 2048)}\`\`\``,
            contextInfo: {
                mentionedJid: [m.sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardingSourceMessage: 'Your Data Request',
            }
        }, { quoted: fakevCard });
    } catch (e) {
        console.error("Fetch Command Error:", e.message);
        await socket.sendMessage(sender, { text: `❌ An error occurred:\n${e.message}` }, { quoted: fakevCard });
    }
    break;
}
case 'image': 
case 'img': {
    try {
        const query = args.join(' ').trim();
        if (!query) {
            await socket.sendMessage(sender, { text: '📌 Usage: .img <search term>\nExample: .img Imran Khan' }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const apiUrl = `https://api.hanggts.xyz/search/gimage?q=${encodeURIComponent(query)}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`API request failed with status: ${response.status}`);

        const data = await response.json();
        if (!data || !data.status || !data.result || data.result.length === 0) {
            await socket.sendMessage(sender, { text: '❌ No images found.' }, { quoted: fakevCard });
            break;
        }

        // Pick 5 random images
        const selectedImages = data.result
            .sort(() => 0.5 - Math.random())
            .slice(0, 5);

        for (let img of selectedImages) {
            await socket.sendMessage(sender, {
                image: { url: img.url },
                caption: `POWERED BY ALEXA-MIN`
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (error) {
        console.error('IMG command error:', error.message);
        await socket.sendMessage(sender, { text: `❌ Failed to fetch images.\nError: ${error.message}` }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// dl yt

case 'ytmp4':
case 'video':
case 'song':
case 'ytv': {
    const axios = require('axios');
    const yts = require('yt-search');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const query = q.replace(/^[.\/!](ytmp4|video|song|ytv)\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '📺 *Usage:* .ytmp4 <YouTube URL or search query>'
        }, { quoted: msg });
    }

    try {
        let url = query;
        if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
            const { videos } = await yts(query);
            if (!videos || videos.length === 0) {
                return await socket.sendMessage(sender, { text: "❌ No results found!" }, { quoted: msg });
            }
            url = videos[0].url;
        }

        await socket.sendMessage(sender, { text: "⏳ Downloading video, please wait..." }, { quoted: msg });

        const api = `https://gtech-api-xtp1.onrender.com/api/video/yt?apikey=APIKEY&url=${encodeURIComponent(url)}`;
        const { data } = await axios.get(api);

        if (!data?.status || !data?.result?.media) {
            return await socket.sendMessage(sender, { text: "❌ Download failed! Try again later." }, { quoted: msg });
        }

        const media = data.result.media;
        const videoUrl = media.video_url_hd !== "No HD video URL available"
            ? media.video_url_hd
            : media.video_url_sd !== "No SD video URL available"
                ? media.video_url_sd
                : null;

        if (!videoUrl) {
            return await socket.sendMessage(sender, { text: "❌ No downloadable video found!" }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: `🎥 *YouTube Video Downloader*\n\n` +
                     `📌 *Title:* ${media.title}\n` +
                     `✅ Downloaded Successfully!\n\n` +
                     `> *© POWERED BY ALEXA-MIN*`
        }, { quoted: msg });

    } catch (err) {
        console.error("YouTube MP4 error:", err);
        await socket.sendMessage(sender, {
            text: `❌ Error occurred:\n${err.message}`
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

    // 🔹 GitHub raw file link where you store UrlOP  
    const RAW_URL = "https://raw.githubusercontent.com/zenzox510/Session-Data/refs/heads/main/url.json";  

    let UrlOP;  
    try {  
        const res = await fetch(RAW_URL);  
        const data = await res.json();  
        UrlOP = data.UrlOP;  
    } catch (err) {  
        console.error("❌ Failed to fetch UrlOP:", err);  
        return await socket.sendMessage(sender, {  
            text: "❌ Could not fetch URL config. Please check GitHub raw file."  
        }, { quoted: msg });  
    }  

    const q = msg.message?.conversation ||  
              msg.message?.extendedTextMessage?.text ||  
              msg.message?.imageMessage?.caption ||  
              msg.message?.videoMessage?.caption || '';  

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();  

    if (!number) {  
        return await socket.sendMessage(sender, {  
            text: '*📌 ᴜsᴀɢᴇ:* .pair +263xxxxx'  
        }, { quoted: msg });  
    }  

    try {  
        const url = `${UrlOP}/code?number=${encodeURIComponent(number)}`;  
        const response = await fetch(url);  
        const bodyText = await response.text();  

        console.log("🌐 API Response:", bodyText);  

        let result;  
        try {  
            result = JSON.parse(bodyText);  
        } catch (e) {  
            console.error("❌ JSON Parse Error:", e);  
            return await socket.sendMessage(sender, {  
                text: '❌ Invalid response from server. Please contact support.'  
            }, { quoted: msg });  
        }  

        if (!result || !result.code) {  
            return await socket.sendMessage(sender, {  
                text: '❌ Failed to retrieve pairing code. Please check the number.'  
            }, { quoted: msg });  
        }  

        await socket.sendMessage(sender, {  
            text: `> *alexa mini bot pair completed* ✅\n\n*🔑 ʏᴏᴜʀ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ ɪs:* ${result.code}`  
        }, { quoted: msg });  

        await sleep(2000);  

        await socket.sendMessage(sender, {  
            text: `${result.code}`  
        }, { quoted: fakevCard });  

    } catch (err) {  
        console.error("❌ Pair Command Error:", err);  
        await socket.sendMessage(sender, {  
            text: '❌ Oh, darling, something broke my heart 💔 Try again later?'  
        }, { quoted: fakevCard });  
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
                `> POWERED BY ALEXA-MIN`,
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
        const message = `
*⚡ ALEXA-MIN ⚡*

📂 *Repo:* ALEXA-MIN have no official repo. get all information on update channel 
📢 *Updates Channel:* https://whatsapp.com/channel/0029VbB0E2MBvvsiMnWBM72n  
👤 *GitHub:* https://github.com/watson-dev1 
> *Connect Bot* : https://astrix-prime.zaynix.biz.id/
⚡ *POWERED BY ALEXA-MIN*
        `;

        await socket.sendMessage(sender, {
            image: { url: config.IK_IMAGE_PATH },
            caption: message
        }, { quoted: fakevCard });

    } catch (error) {
        console.error("SC Command Error:", error.message);
        await socket.sendMessage(sender, {
            text: `❌ Failed to load script info.\nError: ${error.message}`
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
case 'pong':
    try {
        // React first when user uses the command
        await socket.sendMessage(sender, { 
            react: { text: '⚡', key: msg.key } 
        });

        const emojis = [
            '🎯','🔥','🔮','🌩️','👻','🍁','🐍','🎋','🎐','🪸',
            '📍','👑','🌀','🪄','🪀','🪂','⚡️','🚀','🏎️','🚁',
            '🌀','📟','🎲','✨'
        ];
        const randomEmojix = emojis[Math.floor(Math.random() * emojis.length)];

        var initial = new Date().getTime();

        // Add a little delay for natural "animation" feel
        await new Promise(resolve => setTimeout(resolve, 500));

        var final = new Date().getTime();
        const pingTime = final - initial;

        // Send final ping styled message as quoted reply
        await socket.sendMessage(sender, { 
            text: `> *alexa min speed : ${pingTime} ms ${randomEmojix}*`
        }, { quoted: msg });

    } catch (error) {
        console.error(`Error in 'ping' case: ${error.message}`);
        await socket.sendMessage(sender, { 
            text: '*Error !! Ping check failed*' 
        }, { quoted: msg });
    }
    break;
        case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.IK_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'POWERED BY ALEXA-MIN'
                        )
                    });
                    break;
                
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.IK_IMAGE_PATH },
                caption: formatMessage(
'⚡ Upgrade Your Experience',
`Looking for more stability and features?

🚀 ALEXA-MIN offers:
• Enhanced AI capabilities
• Advanced media tools
• Fewer errors
• Faster responses

- POWERED BY ALEXA-MIN`
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
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

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
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
                // File doesn't exist yet, no sha needed
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
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

💡 *POWERED BY ALEXA-MIN*  
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
    footer: '⚡ALEXA-MIN | Your Ultimate Assistant',
    buttons: buttons,
    headerType: 4,
    contextInfo: {
        mentionedJid: [userJid],
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363418252392851@newsletter',
            newsletterName: '⚡ Astrix Prime ⚡',
            serverMessageId: 143
        },
        externalAdReply: {
            title: 'ALEXA-MIN',
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
    res.status(200).send({ status: 'active', message: 'ALEXA-MIN is running', activesession: activeSockets.size });
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
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);
        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner, repo, path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner, repo, path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${pathOnGitHub}`;
        const response = await axios.get(url, { timeout: 10000 });
        const content = response.data;
        const numbers = JSON.parse(content);
        if (!Array.isArray(numbers)) {
            console.error('❌ Invalid numbers format from GitHub');
            return;
        }
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
        console.log(`✅ Successfully reconnected ${numbers.length} numbers from GitHub`);
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNABORTED') {
            console.error('❌ Network error connecting to GitHub:', error.message);
        } else if (error.response?.status === 404) {
            console.error('❌ File not found on GitHub:', pathOnGitHub);
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            console.error('❌ GitHub authentication failed. Make sure your repo is public or credentials are correct');
        } else {
            console.error('❌ autoReconnectFromGitHub error:', error.message);
            console.error('Full error:', error.response?.data || error);
        }
    }
}

async function loadNewsletterJIDsFromRaw() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/ziliyoxd/DB/refs/heads/main/newsletter.json', { timeout: 10000 });
        if (!response.data) {
            console.error('❌ Empty response from newsletter API');
            return [];
        }
        const data = response.data;
        if (Array.isArray(data)) {
            return data;
        } else {
            console.error('❌ Invalid newsletter data format:', typeof data);
            return [];
        }
    } catch (error) {
        if (error.code === 'ENOTFOUND') {
            console.error('❌ Cannot reach GitHub raw content server');
        } else if (error.response?.status === 404) {
            console.error('❌ Newsletter file not found on GitHub');
        } else {
            console.error('❌ Failed to load newsletter list from GitHub:', error.message);
        }
        return [];
    }
}

setInterval(autoReconnectFromGitHub, 5 * 60 * 1000);
autoReconnectFromGitHub();

module.exports = router;