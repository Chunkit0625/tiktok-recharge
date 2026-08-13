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
    let tiktokConnection = null;

    socket.on('setTarget', (username) => {
        const cleanTarget = username ? username.replace(/^@/, '').trim() : '';
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

        tiktokConnection = new TikTokConnection(cleanTarget, { 
            processInitialData: true,
            enableExtendedGiftInfo: true,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            }
        });
        
        tiktokConnection.connect().then(state => {
            console.log(`成功连接到直播间: @${cleanTarget}, Room ID: ${state.roomId}`);
            socket.emit('liveData', { type: 'system', comment: `已连接到直播间 @${cleanTarget}` });
        }).catch(err => {
            console.error(`连接直播间 @${cleanTarget} 失败:`, err.message);
            socket.emit('liveData', { type: 'system', comment: `连接失败: ${err.message}` });
        });

        // 提取更详尽的弹幕用户信息（头像、昵称、唯一ID）
        tiktokConnection.on('chat', data => {
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

        // 提取更详尽的礼物信息、数量及发送者头像
        tiktokConnection.on('gift', data => {
            // 如果礼物在连击中（repeatEnd 为 false），可以根据需要过滤或展示
            if (data.giftType === 1 && !data.repeatEnd) {
                // 连击中的中间状态可按需处理
            }
            
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
        
        tiktokConnection.on('error', err => {
            console.error('[TikTok 错误]:', err.message || err);
        });
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) try { tiktokConnection.disconnect(); } catch (e) {}
    });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
