const express = require('express');
const app = express();
const __path = process.cwd();
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
let code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

// FIX 1: bodyParser MUST be before routes
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// FIX 2: Real pairing route - supports GET /code?number=
app.use('/code', code);

// FIX 3: Pair page - exact file
app.get('/pair', async (req, res) => {
    res.sendFile(__path + '/pair.html');
});

// FIX 4: Home page - exact file
app.get('/', async (req, res) => {
    res.sendFile(__path + '/main.html');
});

// FIX 5: Health check for Render
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// FIX 6: 0.0.0.0 for Render + background fix
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
Don't Forget To Give Star ‼️

ASTRIX-PRIME Server running on http://localhost:${PORT}`)
});

module.exports = app;