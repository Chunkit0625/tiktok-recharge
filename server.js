const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const tiktokLibrary = require('tiktok-live-connector');
const TikTokConnection = tiktokLibrary.TikTokLiveConnection || tiktokLibrary.WebcastPushConnection || tiktokLibrary;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    let tiktokConnection = null;

    socket.on('setTarget', (username) => {
        const cleanTarget = username.replace(/^@/, '').trim();
        
        if (tiktokConnection) {
            try { tiktokConnection.disconnect(); } catch (e) {}
        }

        tiktokConnection = new TikTokConnection(cleanTarget, { processInitialData: false });
        
        tiktokConnection.connect().then(state => {
            socket.emit('liveData', { type: 'system', comment: `已连接到 @${cleanTarget}` });
        }).catch(err => {
            socket.emit('liveData', { type: 'system', comment: `连接失败: ${err.message}` });
        });

        tiktokConnection.on('chat', data => {
            socket.emit('liveData', { type: 'chat', nickname: data.nickname, comment: data.comment });
        });

        tiktokConnection.on('gift', data => {
            socket.emit('liveData', { 
                type: 'gift', 
                nickname: data.nickname, 
                giftName: data.giftName, 
                count: data.repeatCount || 1 
            });
        });
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) try { tiktokConnection.disconnect(); } catch (e) {}
    });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
