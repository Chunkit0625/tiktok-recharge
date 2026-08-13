const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const tiktokLibrary = require('tiktok-live-connector');
const TikTokConnection = tiktokLibrary.TikTokLiveConnection || tiktokLibrary.WebcastPushConnection || tiktokLibrary;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    let connection = null;
    socket.on('setTarget', (username) => {
        if (connection) try { connection.disconnect(); } catch (e) {}
        connection = new TikTokConnection(username.replace('@', ''));
        connection.connect().then(state => socket.emit('liveData', { type: 'system', comment: `已连接: @${username}` }));
        connection.on('chat', data => socket.emit('liveData', { type: 'chat', nickname: data.nickname, comment: data.comment }));
        connection.on('gift', data => socket.emit('liveData', { type: 'gift', nickname: data.nickname, giftName: data.giftName, count: data.repeatCount }));
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
