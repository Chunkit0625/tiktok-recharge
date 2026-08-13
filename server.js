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
  if (!username) return res.status(400).json({ success: false });
  const cleanUser = username.replace(/^@/, '').trim();
  try {
    const response = await axios.get(`https://www.tiktok.com/@${cleanUser}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    const regex = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s;
    const match = response.data.match(regex);
    if (!match) return res.status(404).json({ success: false });
    const jsonData = JSON.parse(match[1]);
    const userInfo = jsonData["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.["userInfo"];
    if (!userInfo) return res.status(404).json({ success: false });
    return res.json({
      success: true,
      username: cleanUser,
      nickname: userInfo.user.nickname,
      avatar: userInfo.user.avatarMedium,
      followers: `${userInfo.stats.followerCount} Followers`
    });
  } catch (err) { res.status(500).json({ success: false }); }
});

io.on('connection', (socket) => {
    let tiktokConnection = null;
    socket.on('setTarget', (username) => {
        const cleanTarget = username.replace(/^@/, '').trim();
        if (tiktokConnection) try { tiktokConnection.disconnect(); } catch (e) {}
        tiktokConnection = new TikTokConnection(cleanTarget, { processInitialData: false });
        tiktokConnection.connect().then(state => {
            socket.emit('liveData', { type: 'system', comment: `已连接 @${cleanTarget}` });
        }).catch(err => {
            socket.emit('liveData', { type: 'system', comment: `连接失败: ${err.message}` });
        });
        tiktokConnection.on('chat', data => socket.emit('liveData', { type: 'chat', nickname: data.nickname, comment: data.comment }));
        tiktokConnection.on('gift', data => socket.emit('liveData', { type: 'gift', nickname: data.nickname, giftName: data.giftName, count: data.repeatCount || 1 }));
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
