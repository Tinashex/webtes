const express = require('express');
const app = express();
const __path = process.cwd();
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;

require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__path)); // serve images, css

// Routes
app.use('/code', require('./pair')); // pairing API

app.get('/pair', (req, res) => {
    res.sendFile(__path + '/pair.html');
});

app.get('/', (req, res) => {
    res.sendFile(__path + '/main.html');
});

// Health check for Railway
app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'ALEXA-MIN' });
});

// Start server - THIS keeps Railway alive
app.listen(PORT, '0.0.0.0', () => {
    console.log(`

  ASTRIX-PRIME Server ON
  Port: ${PORT}
  URL: http://0.0.0.0:${PORT}
============================`)
});

module.exports = app;
