/**
 * 扣扣早餐财经新闻后端服务
 * 实现每日自动抓取功能
 */

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const NewsService = require('./services/newsService');
const { callDoubaoAI, generateQuickAnswer } = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务（用于存储最新新闻数据）
app.use(express.static('./public'));

// 初始化新闻服务
const newsService = new NewsService();

// API路由
app.get('/api/news/domestic', async (req, res) => {
  try {
    const news = await newsService.getDomesticNews();
    res.json({ success: true, data: news });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/news/overseas', async (req, res) => {
  try {
    const news = await newsService.getOverseasNews();
    res.json({ success: true, data: news });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/news/daily', async (req, res) => {
  try {
    const news = await newsService.getDailyNews();
    res.json({ success: true, data: news });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/news/market', async (req, res) => {
  try {
    const market = await newsService.getMarketOverview();
    res.json({ success: true, data: market });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动触发新闻抓取（用于测试）
app.post('/api/admin/fetch-news', async (req, res) => {
  try {
    await newsService.fetchAndSaveNews();
    res.json({ success: true, message: '新闻抓取完成' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取最后更新时间
app.get('/api/admin/last-update', (req, res) => {
  const lastUpdate = newsService.getLastUpdateTime();
  res.json({ success: true, data: { lastUpdate } });
});

// AI问答接口
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { question, newsContent, newsTitle, questionType } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: '问题不能为空' });
    }

    // 如果是快速问题，优先使用预设回答
    if (questionType && generateQuickAnswer(questionType, newsContent || '', newsTitle || '')) {
      const quickAnswer = generateQuickAnswer(questionType, newsContent || '', newsTitle || '');
      return res.json({ success: true, data: { answer: quickAnswer, source: 'quick' } });
    }

    // 调用豆包AI API
    const answer = await callDoubaoAI(
      question,
      newsContent || '这是一篇财经新闻',
      newsTitle || '财经新闻'
    );

    res.json({ success: true, data: { answer, source: 'ai' } });
  } catch (error) {
    console.error('AI问答错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 定时任务：每天早上8:05自动抓取新闻
// cron表达式：秒 分 时 日 月 周
// 0 5 8 * * * = 每天8:05执行
cron.schedule('0 5 8 * * *', async () => {
  console.log('⏰ 开始每日新闻抓取任务...');
  try {
    await newsService.fetchAndSaveNews();
    console.log('✅ 每日新闻抓取完成');
  } catch (error) {
    console.error('❌ 新闻抓取失败:', error);
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 扣扣早餐后端服务已启动，端口: ${PORT}`);
  console.log(`📰 定时新闻抓取任务已配置：每天 8:05 自动执行`);

  // 启动时立即抓取一次新闻
  newsService.fetchAndSaveNews().then(() => {
    console.log('✅ 启动时新闻抓取完成');
  });
});
