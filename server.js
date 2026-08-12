const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 托管 public 文件夹里的静态网页
app.use(express.static(path.join(__dirname, 'public')));

// 查询真实 TikTok 用户数据的 API 路由
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

    // 格式化粉丝数（例如：12500 -> 12.5K）
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
