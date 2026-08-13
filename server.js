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
            console.log('未指定监控目标（留空），停止当前监控');
            if (tiktokConnection) {
                try { tiktokConnection.disconnect(); } catch (e) {}
                tiktokConnection = null;
            }
            return;
        }

        if (tiktokConnection) {
            try { tiktokConnection.disconnect(); } catch (e) {}
        }

        console.log(`正在尝试连接直播间: @${cleanTarget}`);
        tiktokConnection = new TikTokConnection(cleanTarget, { processInitialData: false });
        
        tiktokConnection.connect().then(state => {
            console.log(`成功连接到直播间: @${cleanTarget}`);
            socket.emit('liveData', { type: 'system', comment: `已连接到直播间 @${cleanTarget}` });
        }).catch(err => {
            console.log(`连接直播间 @${cleanTarget} 失败:`, err.message);
            socket.emit('liveData', { type: 'system', comment: `连接失败: ${err.message}` });
        });

        const handleChat = data => {
            const avatarUrl = data.profilePictureUrl || data.userDetails?.profilePictureUrl || data.avatarThumb || '';
            socket.emit('chat', { 
                nickname: data.uniqueId || data.nickname || data.user, 
                comment: data.comment || data.message,
                avatar: avatarUrl
            });
        };

        const handleGift = data => {
            const avatarUrl = data.profilePictureUrl || data.userDetails?.profilePictureUrl || data.avatarThumb || '';
            socket.emit('gift', { 
                nickname: data.uniqueId || data.nickname || data.user, 
                giftName: data.giftName || data.extendedGiftInfo?.name || data.gift || 'Gift', 
                count: data.repeatCount || data.diamondCount || data.count || 1,
                avatar: avatarUrl
            });
        };

        tiktokConnection.on('chat', handleChat);
        tiktokConnection.on('gift', handleGift);
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) try { tiktokConnection.disconnect(); } catch (e) {}
    });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
