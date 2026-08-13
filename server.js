const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// 托管静态网页
app.use(express.static(path.join(__dirname, 'public')));

// 原有的 TikTok 用户查询 API
app.get('/api/tiktok-user', async (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username required' });
    }

    const cleanUser = username.replace(/^@/, '').trim();
    const targetUrl = `https://www.tiktok.com/@${cleanUser}`;

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 8000
        });

        const regex = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s;
        const match = response.data.match(regex);

        if (!match) {
            return res.status(404).json({ success: false, message: 'User not found or captcha triggered' });
        }

        const jsonData = JSON.parse(match[1]);
        const userInfo = jsonData["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.["userInfo"];

        if (!userInfo) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let followerCount = userInfo.stats.followerCount;
        let followerStr = followerCount.toString();
        if (followerCount >= 1000000) {
            followerStr = (followerCount / 1000000).toFixed(1) + 'M';
        } else if (followerCount >= 1000) {
            followerStr = (followerCount / 1000).toFixed(1) + 'K';
        }

        return res.json({
            success: true,
            username: cleanUser,
            nickname: userInfo.user.nickname,
            avatar: userInfo.user.avatarMedium || userInfo.user.avatarLarger,
            followers: `${followerStr} Followers`
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to fetch TikTok data' });
    }
});

// ==========================================
// TikTok 直播实时监控与 WebSocket 广播
// ==========================================
const targetLiveUser = 'khaby.lame'; // 💡 你可以在这里更换成当前正在开播的主播 ID
const tiktokLiveConnection = new WebcastPushConnection(targetLiveUser);

tiktokLiveConnection.connect().then(state => {
    console.log(`[直播监控] 成功连接到主播 @${targetLiveUser} 的直播间，Room ID: ${state.roomId}`);
}).catch(err => {
    console.log(`[直播监控] 连接失败（可能当前未开播）：`, err.message);
});

// 监听弹幕
tiktokLiveConnection.on('chat', data => {
    broadcast({
        type: 'chat',
        nickname: data.nickname,
        comment: data.comment
    });
});

// 监听礼物
tiktokLiveConnection.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    broadcast({
        type: 'gift',
        nickname: data.nickname,
        giftName: data.giftName,
        count: data.repeatCount || 1
    });
});

// 广播给所有连上网站的客户端
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('[WebSocket] 新客户端连入实时监控');
    ws.send(JSON.stringify({ type: 'system', comment: '已成功连入直播实时数据流' }));
});

// 注意：整合了 WebSocket 之后，必须使用 server.listen 启动服务
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
