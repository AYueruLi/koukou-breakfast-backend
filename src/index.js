/**
 * 扣扣早餐财经新闻后端服务
 * 支持AI问答 + 每日新闻自动更新
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');

const newsService = require('./services/newsService');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// ========== 豆包API配置 ==========
const DOUBAO_CONFIG = {
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'ep-20260303114824-tfhrx',
};

const SYSTEM_PROMPT = `你叫"扣扣AI助手"，是专门帮助财经小白理解复杂财经新闻的AI助手。

你需要用最通俗易懂的语言解释财经新闻中的专业概念、背后的逻辑、政策的影响等。

回答要求：
1. 用生活化的比喻解释专业术语
2. 强调对普通人（老百姓）的影响
3. 保持友好、耐心的语气
4. 如果问题超出新闻范围，礼貌地说明并给出合理建议
5. 回答要简洁明了，避免过于冗长

你的目标是用小白也能听懂的语言，让每个人都能理解财经新闻。

新闻内容：
{news_content}

新闻标题：{news_title}`;

// ========== AI问答接口 ==========
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { question, newsContent, newsTitle, questionType } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: '问题不能为空' });
    }

    const apiKey = process.env.ARK_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API Key未配置' });
    }

    const prompt = SYSTEM_PROMPT
      .replace('{news_content}', newsContent || '这是一篇财经新闻')
      .replace('{news_title}', newsTitle || '财经新闻');

    const response = await axios.post(
      `${DOUBAO_CONFIG.baseURL}/chat/completions`,
      {
        model: DOUBAO_CONFIG.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: question }
        ],
        temperature: 0.7,
        max_tokens: 2000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return res.json({ success: true, data: { answer: response.data.choices[0].message.content } });
    }

    throw new Error('AI返回格式错误');
  } catch (error) {
    console.error('AI问答错误:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== 新闻API接口 ==========

// 获取每日新闻 - 返回用户要求的JSON格式
app.get('/api/news/daily', async (req, res) => {
  try {
    const cache = newsService.getNewsCache();

    // 如果缓存为空，先抓取
    if (!cache.lastUpdate) {
      await newsService.updateAllNews();
    }

    const news = newsService.getNewsCache();

    // 转换为用户要求的格式
    const updateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

    res.json({
      success: true,
      data: {
        update_time: updateTime,
        domestic_news: (news.domestic || []).map((item, index) => ({
          id: index + 1,
          title: item.title || '',
          source: item.source || '',
          publish_time: item.publish_time || updateTime,
          url: item.url || '',
          content: item.content || '',
          analysis: item.analysis || ''
        })),
        overseas_news: (news.international || []).map((item, index) => ({
          id: index + 1,
          title: item.title || '',
          source: item.source || '',
          publish_time: item.publish_time || updateTime,
          url: item.url || '',
          content: item.content || '',
          analysis: item.analysis || ''
        })),
        lastUpdate: news.lastUpdate
      }
    });
  } catch (error) {
    console.error('获取新闻失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取国内新闻
app.get('/api/news/domestic', async (req, res) => {
  try {
    const news = newsService.getNewsCache();
    res.json({ success: true, data: news.domestic || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取国外新闻
app.get('/api/news/international', async (req, res) => {
  try {
    const news = newsService.getNewsCache();
    res.json({ success: true, data: news.international || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 强制刷新新闻（手动触发）
app.post('/api/news/refresh', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const adminKey = process.env.ADMIN_API_KEY || 'koukou-secret-key';

    // 简单验证
    if (apiKey !== adminKey) {
      return res.status(403).json({ success: false, error: '无权限' });
    }

    const result = await newsService.forceRefresh();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== 文章解读接口 ==========
// 获取文章内容并生成AI解读 - 改进版
app.post('/api/news/analyze', async (req, res) => {
  try {
    const { url, title } = req.body;

    if (!url && !title) {
      return res.status(400).json({ success: false, error: 'URL或标题不能为空' });
    }

    let articleContent = '';

    // 尝试抓取文章内容
    if (url) {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        });

        // 简单的HTML解析，提取文本内容
        const cheerio = require('cheerio');
        const $ = cheerio.load(response.data);

        // 移除不需要的元素
        $('script, style, nav, header, footer, aside, .advertisement, .ad, .sidebar, .comments, .related').remove();

        // 尝试多种选择器提取主要内容
        const contentSelectors = [
          'article',
          '.article-content',
          '.article-text',
          '.content',
          '.post-content',
          '.news-content',
          'main',
          '#article',
          '.text',
          '.article-body'
        ];

        for (const selector of contentSelectors) {
          const content = $(selector).text();
          if (content && content.length > 200) {
            articleContent = content;
            break;
          }
        }

        // 如果还是空的，就获取所有段落
        if (!articleContent || articleContent.length < 100) {
          articleContent = $('p').map((i, el) => $(el).text()).get().join('\n');
        }

        // 清理内容 - 移除多余空白
        articleContent = articleContent
          .replace(/\s+/g, ' ')
          .replace(/^\s+|\s+$/g, '')
          .substring(0, 3000);

        // 如果抓取的内容太短，标记为需要看原文
        if (articleContent.length < 50) {
          articleContent = '';
        }
      } catch (e) {
        console.log('抓取文章内容失败:', e.message);
        articleContent = '';
      }
    }

    // 使用AI生成解读
    const apiKey = process.env.ARK_API_KEY;
    let aiAnalysis = null;

    if (apiKey && title) {
      try {
        // 改进的prompt - 要求AI直接生成结构化输出
        const prompt = `你叫"扣扣AI助手"，是专门帮助财经小白理解复杂财经新闻的AI助手。

请根据以下新闻标题生成详细的解读。我需要你用最通俗易懂的语言解释，因为读者是完全不懂财经的普通人。

新闻标题：${title}
${articleContent ? '新闻内容摘要：' + articleContent.substring(0, 1500) : ''}

请严格按照以下格式回答（每部分50-150字）：

【这是什么意思？】
（用通俗易懂的语言解释这条新闻在说什么）

【为什么会这样？】
（解释这条新闻发生的背景和原因）

【跟我有什么关系？】
（说明这条新闻对普通人（老百姓）的影响，比如对钱包、工作、生活的影响）`;

        const response = await axios.post(
          `${DOUBAO_CONFIG.baseURL}/chat/completions`,
          {
            model: DOUBAO_CONFIG.model,
            messages: [
              { role: 'system', content: '你是一个财经新闻解读助手，用通俗易懂的语言帮助普通人理解财经新闻。你的特点是：用生活化的比喻解释专业术语，强调对普通人的影响，回答简洁明了。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 1500
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey.replace(/export\s+ARK_API_KEY=|["']/g, '')}`
            },
            timeout: 30000
          }
        );

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          const aiText = response.data.choices[0].message.content;

          // 解析AI回答 - 使用更可靠的匹配方式
          const meaningMatch = aiText.match(/【这是什么意思？】([\s\S]*?)(?=【|$)/);
          const reasonMatch = aiText.match(/【为什么会这样？】([\s\S]*?)(?=【|$)/);
          const impactMatch = aiText.match(/【跟我有什么关系？】([\s\S]*?)$/);

          if (meaningMatch && reasonMatch && impactMatch) {
            aiAnalysis = {
              meaning: meaningMatch[1].trim().substring(0, 300),
              reason: reasonMatch[1].trim().substring(0, 300),
              impact: impactMatch[1].trim().substring(0, 300)
            };
          } else {
            // 如果格式解析失败，直接使用原始回答
            aiAnalysis = {
              meaning: aiText.substring(0, 300),
              reason: '点击下方AI助手了解更多详情',
              impact: '点击下方AI助手了解更多详情'
            };
          }
        }
      } catch (e) {
        console.log('AI解读生成失败:', e.message);
      }
    }

    // 返回结果
    res.json({
      success: true,
      data: {
        content: articleContent || `这是一篇关于"${title}"的财经新闻。点击"阅读原文"查看完整内容。`,
        aiAnalysis: aiAnalysis
      }
    });
  } catch (error) {
    console.error('文章分析错误:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== 定时任务 ==========

// 每天早上8:00（北京时间）执行新闻更新
// 北京时间8:00 = UTC 0:00
// 严格在每天8:00删除旧资讯，全部更新为24小时以内的重要财经新闻
cron.schedule('0 0 8 * * *', async () => {
  console.log('⏰ 定时任务触发: 开始更新新闻 (每天8:00)');
  console.log('🗑️ 正在删除旧资讯...');
  try {
    // 清空旧数据
    await newsService.clearOldNews();
    // 抓取新数据
    await newsService.updateAllNews();
    console.log('✅ 定时新闻更新完成 - 已删除旧资讯，更新为24小时内新闻');
  } catch (error) {
    console.error('❌ 定时新闻更新失败:', error);
  }
}, {
  timezone: 'Asia/Shanghai'
});

// 启动时立即更新一次新闻
console.log('🚀 启动时首次抓取新闻...');
newsService.updateAllNews().catch(err => {
  console.error('首次抓取失败:', err);
});

// ========== 健康检查 ==========
app.get('/health', (req, res) => {
  const news = newsService.getNewsCache();
  res.json({
    status: 'ok',
    message: '扣扣早餐后端服务运行中',
    newsCount: {
      domestic: news.domestic?.length || 0,
      international: news.international?.length || 0
    },
    lastUpdate: news.lastUpdate
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 扣扣早餐后端服务已启动，端口: ${PORT}`);
  console.log(`📰 定时新闻更新: 每天 08:00 (北京时间)`);
});
