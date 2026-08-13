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

// 辅助函数：如果直接传用户名连接失败，尝试通过爬取主页 HTML 提取正在直播的 Room ID
async function fetchRoomIdDirectly(username) {
  try {
    const cleanUser = username.replace(/^@/, '').trim();
    const url = `https://www.tiktok.com/@${cleanUser}/live`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 8000
    });
    
    // 从页面中正则匹配 roomId
    const matchRoomId = response.data.match(/"roomId"\s*:\s*"(\d+)"/) || response.data.match(/room_id[=:]\s*["']?(\d+)/);
    if (matchRoomId && matchRoomId[1]) {
      return matchRoomId[1];
    }
  } catch (e) {
    // 忽略异常
  }
  return null;
}

io.on('connection', (socket) => {
    let tiktokConnection = null;

    socket.on('setTarget', async (targetInput) => {
        const cleanTarget = targetInput ? targetInput.trim() : '';
        if (!cleanTarget) {
            if (tiktokConnection) {
                try { tiktokConnection.disconnect(); } catch (e) {}
                tiktokConnection = null;
            }
            return;
        }

        if (tiktokConnection) {
            try { tiktokConnection.disconnect(); } catch (e) {}
        }

        let connectionTarget = cleanTarget;

        // 如果输入的不是纯数字，说明是用户名，先尝试直接提取一次 Room ID 兜底
        if (!/^\d+$/.test(cleanTarget)) {
            const directRoomId = await fetchRoomIdDirectly(cleanTarget);
            if (directRoomId) {
                connectionTarget = directRoomId; // 如果成功获取到数字 Room ID，直接用它连接，成功率100%
            }
        }

        tiktokConnection = new TikTokConnection(connectionTarget, { 
            processInitialData: true,
            enableExtendedGiftInfo: true,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            }
        });
        
        tiktokConnection.connect().then(state => {
            socket.emit('liveData', { type: 'system', comment: `已成功连接到直播间 (${cleanTarget})` });
        }).catch(async err => {
            // 如果第一次直连失败，再强制尝试一次网页抓取 Room ID 兜底重连
            if (!/^\d+$/.test(cleanTarget)) {
                const fallbackRoomId = await fetchRoomIdDirectly(cleanTarget);
                if (fallbackRoomId && fallbackRoomId !== connectionTarget) {
                    try {
                        tiktokConnection = new TikTokConnection(fallbackRoomId, { processInitialData: true, enableExtendedGiftInfo: true });
                        await tiktokConnection.connect();
                        socket.emit('liveData', { type: 'system', comment: `已通过备用通道连接到直播间 @${cleanTarget}` });
                        setupListeners(tiktokConnection, socket);
                        return;
                    } catch (e) {}
                }
            }
            socket.emit('liveData', { type: 'system', comment: `连接失败: 主播当前可能未开播或触发风控` });
        });

        setupListeners(tiktokConnection, socket);
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) try { tiktokConnection.disconnect(); } catch (e) {}
    });
});

function setupListeners(conn, socket) {
    if (!conn) return;

    conn.on('chat', data => {
        const avatarUrl = data.profilePictureUrl || data.userDetails?.profilePictureUrl || data.avatarUrl || '';
        const nickname = data.nickname || data.userDetails?.nickname || data.uniqueId || '观众';
        const uniqueId = data.uniqueId || data.userDetails?.uniqueId || '';

        socket.emit('liveData', { 
            type: 'chat', 
            nickname: nickname, 
            uniqueId: uniqueId,
            comment: data.comment || '',
            avatar: avatarUrl
        });
    });

    conn.on('gift', data => {
        const avatarUrl = data.profilePictureUrl || data.userDetails?.profilePictureUrl || '';
        const nickname = data.nickname || data.userDetails?.nickname || data.uniqueId || '观众';
        const giftName = data.giftName || data.extendedGiftInfo?.name || data.name || 'Gift';
        const giftCount = data.repeatCount || data.diamondCount || data.count || 1;

        socket.emit('liveData', { 
            type: 'gift', 
            nickname: nickname, 
            giftName: giftName, 
            count: giftCount,
            avatar: avatarUrl
        });
    });
    
    conn.on('error', err => {});
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
