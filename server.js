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

// TikTok 用户查询 API
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
// WebSocket 动态直播间实时监控
// ==========================================
wss.on('connection', (ws) => {
    console.log('[WebSocket] 新客户端连入实时监控');
    ws.send(JSON.stringify({ type: 'system', comment: '已连接，请输入要监控的主播ID' }));

    let currentLiveConnection = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'setTarget' && data.username) {
                const targetLiveUser = data.username.replace(/^@/, '').trim();
                console.log(`[直播监控] 客户端请求切换监控主播: @${targetLiveUser}`);

                // 如果之前有连接，先断开
                if (currentLiveConnection) {
                    try { currentLiveConnection.disconnect(); } catch(e) {}
                }

                currentLiveConnection = new WebcastPushConnection(targetLiveUser);

                currentLiveConnection.connect().then(state => {
                    ws.send(JSON.stringify({ type: 'system', comment: `成功连接到 @${targetLiveUser} 直播间` }));
                }).catch(err => {
                    ws.send(JSON.stringify({ type: 'system', comment: `连接 @${targetLiveUser} 失败（可能未开播）` }));
                });

                currentLiveConnection.on('chat', chatData => {
                    ws.send(JSON.stringify({
                        type: 'chat',
                        nickname: chatData.nickname,
                        comment: chatData.comment
                    }));
                });

                currentLiveConnection.on('gift', giftData => {
                    if (giftData.giftType === 1 && !giftData.repeatEnd) return;
                    ws.send(JSON.stringify({
                        type: 'gift',
                        nickname: giftData.nickname,
                        giftName: giftData.giftName,
                        count: giftData.repeatCount || 1
                    }));
                });
            }
        } catch (e) {
            console.error('解析客户端消息失败', e);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
