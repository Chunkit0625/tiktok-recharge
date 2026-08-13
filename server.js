const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 兼容最新版(TikTokLiveConnection)与旧版(WebcastPushConnection)的引入方式
const tiktokLibrary = require('tiktok-live-connector');
const TikTokConnection = tiktokLibrary.TikTokLiveConnection || tiktokLibrary.WebcastPushConnection || tiktokLibrary;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 托管 public 目录静态页面
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('[系统] 客户端已通过 WebSocket 连接');
    let tiktokConnection = null;

    // 接收前端发来的监控目标
    socket.on('setTarget', (username) => {
        console.log(`[系统] 正在尝试连接主播: @${username}`);

        // 如果此前有连接，先断开
        if (tiktokConnection) {
            try {
                tiktokConnection.disconnect();
            } catch (e) {}
        }

        try {
            // 使用兼容后的构造函数创建连接
            tiktokConnection = new TikTokConnection(username);

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
                    comment: `连接失败: ${err.message || '可能未开播或账号输入错误'}`
                });
            });

            // 监听聊天弹幕
            tiktokConnection.on('chat', data => {
                socket.emit('liveData', {
                    type: 'chat',
                    nickname: data.nickname || data.user?.nickname || '匿名',
                    comment: data.comment
                });
            });

            // 监听礼物
            tiktokConnection.on('gift', data => {
                socket.emit('liveData', {
                    type: 'gift',
                    nickname: data.nickname || data.user?.nickname || '匿名',
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

            // 捕获连接内部异常，防止服务崩溃
            tiktokConnection.on('error', err => {
                console.error('[TikTok 报错]', err);
            });

        } catch (err) {
            console.error('[创建连接失败]', err.message);
            socket.emit('liveData', {
                type: 'system',
                comment: `初始化失败: ${err.message}`
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
    console.log(`==================================================`);
    console.log(`服务已成功启动！`);
    console.log(`请打开浏览器访问: http://localhost:${PORT}`);
    console.log(`==================================================`);
});
