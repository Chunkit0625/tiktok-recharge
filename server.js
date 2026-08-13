const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const tiktokLibrary = require('tiktok-live-connector');
const TikTokConnection = tiktokLibrary.TikTokLiveConnection || tiktokLibrary.WebcastPushConnection || tiktokLibrary;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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

io.on('connection', (socket) => {
    console.log('[系统] 客户端已通过 WebSocket 连接');
    let tiktokConnection = null;

    socket.on('setTarget', (username) => {
        const cleanTarget = username.replace(/^@/, '').trim();
        console.log(`[系统] 正在尝试连接主播直播间: @${cleanTarget}`);

        if (tiktokConnection) {
            try {
                tiktokConnection.disconnect();
            } catch (e) {}
        }

        try {
            tiktokConnection = new TikTokConnection(cleanTarget, {
                processInitialData: false
            });

            tiktokConnection.on('error', err => {
                console.error('[TikTok 内部错误]:', err.message || err);
            });

            tiktokConnection.connect().then(state => {
                console.log(`[成功] 已连接到房间 ID: ${state.roomId}`);
                socket.emit('liveData', {
                    type: 'system',
                    comment: `已成功连接到 @${cleanTarget} 的直播间 (RoomID: ${state.roomId})`
                });
            }).catch(err => {
                console.error(`[错误] 连接 @${cleanTarget} 失败:`, err.message);
                socket.emit('liveData', {
                    type: 'system',
                    comment: `连接失败: ${err.message} (请确保该主播当前正在直播)`
                });
            });

            tiktokConnection.on('chat', data => {
                const nickname = data.nickname || data.user?.nickname || '热心观众';
                const comment = data.comment || data.content || data.text || '';
                socket.emit('liveData', {
                    type: 'chat',
                    nickname: nickname,
                    comment: comment
                });
            });

            tiktokConnection.on('gift', data => {
                const nickname = data.nickname || data.user?.nickname || '热心观众';
                const giftName = data.giftName || data.gift?.name || '未知礼物';
                const count = data.repeatCount || data.diamondCount || data.combo || 1;
                socket.emit('liveData', {
                    type: 'gift',
                    nickname: nickname,
                    giftName: giftName,
                    count: count
                });
            });

            tiktokConnection.on('streamEnd', () => {
                socket.emit('liveData', {
                    type: 'system',
                    comment: `主播 @${cleanTarget} 已下播`
                });
            });

        } catch (err) {
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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```[cite: 1]
