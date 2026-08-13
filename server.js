const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const tiktokLibrary = require('tiktok-live-connector');
const TikTokConnection = tiktokLibrary.TikTokLiveConnection || tiktokLibrary.WebcastPushConnection || tiktokLibrary;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('[系统] 客户端已通过 WebSocket 连接');
    let tiktokConnection = null;

    socket.on('setTarget', (username) => {
        console.log(`[系统] 正在尝试连接主播: @${username}`);

        if (tiktokConnection) {
            try {
                tiktokConnection.disconnect();
            } catch (e) {}
        }

        try {
            tiktokConnection = new TikTokConnection(username);

            // 监听错误，防止进程崩溃
            tiktokConnection.on('error', err => {
                console.error('[TikTok 内部错误捕获]:', err.message || err);
                socket.emit('liveData', {
                    type: 'system',
                    comment: `连接异常: ${err.message || '未知错误'}`
                });
            });

            tiktokConnection.connect().then(state => {
                console.log(`[成功] 已连接到房间 ID: ${state.roomId}`);
                socket.emit('liveData', {
                    type: 'system',
                    comment: `已成功连接到 @${username} 的直播间 (RoomID: ${state.roomId})`
                });
            }).catch(err => {
                console.error(`[错误] 连接 @${username} 失败:`, err.message);
                socket.emit('liveData', {
                    type: 'system',
                    comment: `连接失败: ${err.message} (可能未开播或网络受限)`
                });
            });

            tiktokConnection.on('chat', data => {
                socket.emit('liveData', {
                    type: 'chat',
                    nickname: data.nickname || '匿名',
                    comment: data.comment
                });
            });

            tiktokConnection.on('gift', data => {
                socket.emit('liveData', {
                    type: 'gift',
                    nickname: data.nickname || '匿名',
                    giftName: data.giftName,
                    count: data.repeatCount || data.diamondCount || 1
                });
            });

            tiktokConnection.on('streamEnd', () => {
                socket.emit('liveData', {
                    type: 'system',
                    comment: `主播 @${username} 已下播`
                });
            });

        } catch (err) {
            console.error('[初始化捕获异常]:', err.message);
            socket.emit('liveData', {
                type: 'system',
                comment: `初始化错误: ${err.message}`
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('[系统] 客户端断开连接');
        if (tiktokConnection) {
            try {
                tiktokConnection.disconnect();
            } catch (e) {}
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`服务已启动: http://localhost:${PORT}`);
});
