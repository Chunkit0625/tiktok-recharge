const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =================【全新随机账号与 1 个月到期配置】=================
// 到期日期设置为 2026-09-13，每个账号限制 1 台设备
const USER_DATABASE = {
  "au0491": { password: "123456", expireDate: "2026-09-13", maxDevices: 1 },
  "gv9384": { password: "123456", expireDate: "2026-09-13", maxDevices: 1 },
  "ac1322": { password: "123456", expireDate: "2026-09-13", maxDevices: 1 },
  "aa1513": { password: "123456", expireDate: "2026-09-13", maxDevices: 1 },
  "zx1251": { password: "123456", expireDate: "2026-09-13", maxDevices: 1 }
};

// 内存中记录已绑定的设备
const deviceBindings = {}; 
// ==================================================================

// 1. 登录验证 API
app.post('/api/login', (req, res) => {
  const { username, password, deviceId } = req.body;
  const user = USER_DATABASE[username];

  if (!user || user.password !== password) {
    return res.json({ success: false, message: '账号或密码错误！' });
  }

  // 校验月卡到期时间
  const now = new Date().getTime();
  const expireTime = new Date(user.expireDate + " 23:59:59").getTime();
  if (now > expireTime) {
    return res.json({ success: false, message: `该账号已于 ${user.expireDate} 到期，请联系管理员续费` });
  }

  // 校验并绑定设备
  if (!deviceBindings[username]) {
    deviceBindings[username] = [];
  }

  const boundList = deviceBindings[username];
  if (!boundList.includes(deviceId)) {
    if (boundList.length >= user.maxDevices) {
      return res.json({ 
        success: false, 
        message: `登录失败：该账号最多允许在 ${user.maxDevices} 台设备上使用` 
      });
    }
    boundList.push(deviceId);
  }

  const token = Buffer.from(`${username}:${expireTime}`).toString('base64');
  res.json({
    success: true,
    message: '登录成功',
    token: token
  });
});

// 2. 头像图片代理 API（解决 TikTok CDN 防盗链跨域拦截）
app.get('/api/avatar-proxy', (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('URL required');

  const client = imageUrl.startsWith('https') ? https : http;

  client.get(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://www.tiktok.com/'
    }
  }, (response) => {
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    response.pipe(res);
  }).on('error', (err) => {
    res.status(500).send('Image fetch failed');
  });
});

// 3. TikTok 数据接口（带鉴权）
app.get('/api/tiktok-user', async (req, res) => {
  const token = req.headers['authorization'];
  const deviceId = req.headers['x-device-id'];

  if (!token || !deviceId) {
    return res.status(401).json({ success: false, message: '未授权：请先登录账号' });
  }

  try {
    const [username, expireTime] = Buffer.from(token, 'base64').toString('utf8').split(':');
    const user = USER_DATABASE[username];

    if (!user || Date.now() > Number(expireTime)) {
      return res.status(403).json({ success: false, message: '账号登录已失效或月卡已过期' });
    }

    const boundList = deviceBindings[username] || [];
    if (!boundList.includes(deviceId)) {
      return res.status(403).json({ success: false, message: '未授权设备访问，请重新登录' });
    }
  } catch (e) {
    return res.status(401).json({ success: false, message: '无效的鉴权 Token' });
  }

  const { username } = req.query;
  if (!username) return res.json({ success: false, message: 'Missing username' });

  try {
    const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) return res.json({ success: false, message: 'User not found' });
    const html = await response.text();

    const avatarMatch = html.match(/"avatarLarger":"(https:[^"]+)"/) || html.match(/"avatarMedium":"(https:[^"]+)"/);
    const nicknameMatch = html.match(/"nickname":"([^"]+)"/);
    const followerMatch = html.match(/"followerCount":(\d+)/);

    let avatar = avatarMatch ? avatarMatch[1].replace(/\\u0026/g, '&') : '';
    let nickname = nicknameMatch ? nicknameMatch[1] : username;
    let followers = followerMatch ? Number(followerMatch[1]).toLocaleString() + ' Followers' : '0 Followers';

    if (!avatar) return res.json({ success: false, message: 'User not found' });

    res.json({
      success: true,
      username: username,
      nickname: nickname,
      avatar: avatar,
      followers: followers
    });
  } catch (error) {
    res.json({ success: false, message: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
