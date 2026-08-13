const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 托管 public 文件夹中的静态网页
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('[系统] 客户端已通过 WebSocket 连接');
    let tiktokConnection = null;

    // 接收前端发来的监控目标
    socket.on('setTarget', (username) => {
        console.log(`[系统] 正在尝试连接主播: @${username}`);

        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

        tiktokConnection = new WebcastPushConnection(username);

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
                comment: `连接失败: ${err.message} (可能未开播或账号输入错误)`
            });
        });

        // 监听聊天弹幕
        tiktokConnection.on('chat', data => {
            socket.emit('liveData', {
                type: 'chat',
                nickname: data.nickname,
                comment: data.comment
            });
        });

        // 监听礼物
        tiktokConnection.on('gift', data => {
            socket.emit('liveData', {
                type: 'gift',
                nickname: data.nickname,
                giftName: data.giftName,
                count: data.repeatCount || data.diamondCount || 1
            });
        });

        // 监听下播
        tiktokConnection.on('streamEnd', () => {
            socket.emit('liveData', {
                type: 'system',
                comment: `主播 @${username} 已下播`
            });
        });
    });

    socket.on('disconnect', () => {
        console.log('[系统] 客户端断开连接');
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`服务已成功启动！`);
    console.log(`请打开浏览器访问: http://localhost:${PORT}`);
    console.log(`==================================================`);
});
