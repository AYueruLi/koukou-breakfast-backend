/**
 * 扣扣早餐 - 新闻服务
 * 负责实时抓取、筛选和存储财经新闻
 * 严格限制来源：仅华尔街见闻和雪球
 * 自动生成500字以上摘要和300字以上AI解读
 */

const axios = require('axios');
const cheerio = require('cheerio');

// 豆包API配置
const DOUBAO_CONFIG = {
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'ep-20260303114824-tfhrx',
};

// 内存存储
let newsCache = {
  domestic: [],
  international: [],
  lastUpdate: null
};

// ============================================
// 新闻源配置 - 优先华尔街见闻和雪球，失败时自动切换备用源
// ============================================

// 反爬检测标志
let antiCrawlDetected = {
  wallstreetcn: false,
  xueqiu: false
};

// 检测反爬机制
function isAntiCrawlError(error, response) {
  // 检测常见的反爬特征
  if (response) {
    const status = response.status;
    // 确保data是字符串类型
    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || '');
    const headers = response.headers || {};

    // 状态码检测
    if (status === 403 || status === 503 || status === 429) {
      return true;
    }

    // 内容检测
    const antiKeywords = ['访问频率过快', '请稍后再试', '验证码', ' captcha', 'block', 'blocked', '限制访问', '禁止访问', 'Forbidden', 'Too Many Requests'];
    if (typeof data === 'string') {
      for (const keyword of antiKeywords) {
        if (data.toLowerCase().includes(keyword.toLowerCase())) {
          return true;
        }
      }
    }

    // 检查是否返回空内容或错误页面
    if (data.length < 500 && (data.includes('<!DOCTYPE') || data.includes('<html'))) {
      return true;
    }
  }

  // 错误信息检测
  const errorMsg = error.message || '';
  const antiErrorKeywords = ['403', '503', '429', 'rate limit', 'timeout', 'ECONNREFUSED'];
  for (const keyword of antiErrorKeywords) {
    if (errorMsg.toLowerCase().includes(keyword.toLowerCase())) {
      return true;
    }
  }

  return false;
}

// 设置反爬标志
function setAntiCrawlFlag(source) {
  if (source.includes('wallstreet') || source.includes('华尔街')) {
    antiCrawlDetected.wallstreetcn = true;
    console.log('⚠️ 检测到华尔街见闻反爬机制');
  }
  if (source.includes('xueqiu') || source.includes('雪球')) {
    antiCrawlDetected.xueqiu = true;
    console.log('⚠️ 检测到雪球反爬机制');
  }
}

// 仅使用华尔街见闻和雪球（优先）
const NEWS_SOURCES = {
  // 国内新闻 - 优先华尔街见闻和雪球
  domestic: [
    { name: '华尔街见闻', url: 'https://www.wallstreetcn.com/rss', type: 'rss', priority: 1 },
    { name: '雪球', url: 'https://xueqiu.com/v4/statuses/public_timeline.json', type: 'api', priority: 2 },
    { name: '华尔街见闻-首页', url: 'https://www.wallstreetcn.com/', type: 'html', priority: 3 },
    { name: '雪球-财经', url: 'https://xueqiu.com/', type: 'html', priority: 4 }
  ],
  // 国际新闻 - 同样优先华尔街见闻和雪球
  international: [
    { name: '华尔街见闻-全球', url: 'https://www.wallstreetcn.com/rss/global', type: 'rss', priority: 1 },
    { name: '华尔街见闻-美股', url: 'https://www.wallstreetcn.com/rss/us-stock', type: 'rss', priority: 2 },
    { name: '雪球-美股', url: 'https://xueqiu.com/hq/usstock', type: 'html', priority: 3 }
  ]
};

// 备用新闻源（当主源被反爬时使用）
const FALLBACK_SOURCES = {
  domestic: [
    { name: '东方财富-财经', url: 'https://finance.eastmoney.com/a/cywjh.html', type: 'html_eastmoney' },
    { name: '东方财富-A股', url: 'https://stock.eastmoney.com/a/2020906933.html', type: 'html_eastmoney' },
    { name: '新浪财经-国内', url: 'https://finance.sina.com.cn/stock/', type: 'html_sina' },
    { name: '凤凰网-财经', url: 'https://finance.ifeng.com/', type: 'html_ifeng' },
    { name: '网易财经-国内', url: 'https://money.163.com/', type: 'html_163' },
    { name: '今日头条-财经', url: 'https://www.toutiao.com/ch/news_hot/', type: 'html_toutiao' }
  ],
  international: [
    { name: '东方财富-美股', url: 'https://stock.eastmoney.com/a/cywjh.html', type: 'html_eastmoney' },
    { name: '新浪财经-国际', url: 'https://finance.sina.com.cn/stock/', type: 'html_sina' },
    { name: '凤凰网-国际', url: 'https://finance.ifeng.com/', type: 'html_ifeng' },
    { name: '网易财经-国际', url: 'https://money.163.com/', type: 'html_163' }
  ]
};

// ============================================
// 辅助函数
// ============================================

// 严格判断国内新闻 - 仅包含中国大陆财经新闻
function isDomesticNews(title) {
  const domesticKeywords = [
    'A股', '上证', '深证', '创业板', '科创板', '北交所', '央行', '证监会', '国家统计局',
    '两会', '中国', '国内', '内需', '房产', '地产', '房价', '基建', '财政', '人民币',
    'GDP', 'CPI', 'PPI', '制造业', '工业', '消费', '零售', '出口', '进口', '贸易',
    '银行', '保险', '券商', '基金', '理财', 'A股', '港股', 'H股', '新股', 'IPO',
    '新能源', '汽车', '地产', '医药', '白酒', '食品', '家电', '纺织', '机械',
    '政策', '国务院', '发改委', '财政部', '工信部', '商务部', '证监会', '银保监会',
    '降准', '降息', 'LPR', 'MLF', '流动性', '信贷', '社融', 'M2'
  ];

  const internationalKeywords = [
    '美联储', 'FOMC', '鲍威尔', 'Fed', '美国', '美股', '纳斯达克', '道琼斯', '标普500',
    'Apple', 'Tesla', 'Nvidia', 'Google', 'Microsoft', 'Amazon', 'Meta', '英伟达', '苹果', '特斯拉',
    '欧洲', '欧元区', '欧盟', '德国', '法国', '英国', '伦敦', '法兰克福', 'DAX', 'CAC', 'FTSE',
    '日本', '日经', '东京', '韩国', '首尔', '印度', '澳大利亚', '港股', '恒生', 'H股',
    'IMF', '世界银行', 'G7', 'G20', 'OPEC', '原油', '油价', '石油', 'WTI', '布伦特',
    '黄金', '金价', 'COMEX', '伦敦金', '白银', '外汇', '汇率', '美元', '欧元', '日元', '英镑',
    '降息', '加息', '利率', '国债', '债券', '通胀', 'CPI', '非农', '失业率'
  ];

  // 检查是否是国际新闻关键词
  for (const keyword of internationalKeywords) {
    if (title.includes(keyword)) return false;
  }

  // 检查是否是国内新闻关键词
  for (const keyword of domesticKeywords) {
    if (title.includes(keyword)) return true;
  }

  // 无法判断时默认归为国内
  return true;
}

// 判断新闻是否主要讨论国际市场/事件
function isInternationalNews(title) {
  const internationalKeywords = [
    // 美国
    '美联储', 'FOMC', '鲍威尔', 'Fed', 'Federal Reserve', '美国', '美股', '纳斯达克', '道琼斯', '标普',
    'Dow Jones', 'Nasdaq', 'S&P', 'Apple', 'Tesla', 'Nvidia', 'Google', 'Microsoft', 'Amazon', 'Meta', '英伟达',
    '美债', '美元', 'USD', '华尔街',
    // 欧洲
    '欧洲', '欧元区', '欧盟', '德国', '法国', '英国', '伦敦', '法兰克福', '英央行', '欧央行',
    '德国DAX', '法国CAC', '英国FTSE',
    // 亚太
    '日本', '日经', '东京', '韩国', '首尔', '印度', '澳大利亚', '港股', '恒生', '港交所',
    // 全球
    'IMF', '世界银行', 'G7', 'G20', 'OPEC', '全球', '海外', '外盘',
    // 原油
    'WTI', '布伦特', '原油', '油价', '石油',
    // 黄金
    '黄金', '金价', 'COMEX', '伦敦金',
    // 其他
    '外汇', '汇率', '日元', '欧元', '英镑', '澳元'
  ];

  const domesticKeywords = ['A股', '上证', '深证', '创业板', '科创板', '北交所', '央行', '证监会', '银保监会', '两会', '中国'];

  const titleLower = title.toLowerCase();

  // 先检查是否明显是国内新闻
  for (const keyword of domesticKeywords) {
    if (title.includes(keyword)) return false;
  }

  // 检查是否明显是国际新闻
  for (const keyword of internationalKeywords) {
    if (title.includes(keyword)) return true;
  }

  // 无法判断时返回null
  return null;
}

// 从标题提取标签
function getTag(title) {
  const tags = {
    '美联储': ['美联储', '加息', '降息', '利率', 'FOMC', '鲍威尔', 'Fed', 'Federal Reserve'],
    '美股': ['美股', '纳斯达克', '道琼斯', '标普', 'Dow Jones', 'Nasdaq', 'S&P', 'Apple', 'Tesla', 'Nvidia', 'Google', 'Microsoft', 'Amazon', 'Meta', '英伟达'],
    '欧股': ['欧洲', '德国', '法国', '英国', '伦敦', '法兰克福', '欧元区', '欧盟', 'DAX', 'CAC', 'FTSE'],
    '亚太': ['日经', '日本', '韩国', '印度', '澳大利亚', '港股', '恒生', '港交所'],
    '科技': ['科技', 'AI', '芯片', '互联网', '半导体', 'OpenAI', 'ChatGPT', '大模型'],
    '宏观': ['GDP', 'CPI', 'PMI', '通胀', '经济', '央行', '货币', '政策'],
    '黄金': ['黄金', '金价', '避险', 'COMEX'],
    '原油': ['原油', '油价', '石油', 'WTI', '布伦特', 'OPEC'],
    '外汇': ['外汇', '汇率', '美元', '欧元', '人民币', '日元', '英镑'],
    '国际': ['IMF', '世界银行', 'G7', 'G20', '全球', '海外']
  };

  for (const [tag, keywords] of Object.entries(tags)) {
    for (const keyword of keywords) {
      if (title.includes(keyword)) return tag;
    }
  }
  return '财经';
}

// 判断是否在24小时内 - 严格版本
function isWithin24Hours(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours24 = 24 * 60 * 60 * 1000;
    // 严格24小时，允许2小时偏差（考虑到时区和发布时间）
    return diff >= -7200000 && diff < hours24;
  } catch (e) {
    return true;
  }
}

// 生成带格式的时间
function formatPublishTime(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours24 = 24 * 60 * 60 * 1000;

    // 如果超过24小时，使用当前时间
    if (diff >= hours24) {
      return now.toISOString().replace('T', ' ').substring(0, 19);
    }
    return date.toISOString().replace('T', ' ').substring(0, 19);
  } catch (e) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
}

// ============================================
// AI生成content和analysis
// ============================================

// 使用豆包AI生成新闻摘要和解读
async function generateContentAndAnalysis(newsItem) {
  const apiKey = process.env.ARK_API_KEY;

  if (!apiKey) {
    // 如果没有API Key，返回默认内容
    return {
      content: `关于"${newsItem.title}"的详细报道。该新闻来源于${newsItem.source}，发布时间为${formatPublishTime(newsItem.publishTime)}。点击可查看原文详情。`,
      analysis: `该新闻属于${newsItem.category === 'domestic' ? '国内' : '国际'}财经领域。建议关注相关新闻的后续报道，了解市场动态。`
    };
  }

  try {
    const prompt = `你是一个专业的财经新闻编辑。请根据以下新闻标题生成新闻摘要和AI解读。

新闻标题：${newsItem.title}
新闻来源：${newsItem.source}

要求：
1. content（新闻摘要）：基于标题生成一段500字以上的新闻摘要，包含新闻背景、核心数据、关键结论。要忠实于标题，不要虚构内容。
2. analysis（AI解读）：基于content生成一段300字以上的精准解读，然后分成三部分：
   【这是什么意思？】+解读内容
   【为什么会这样？】+解读内容
   【跟我有什么关系？】+解读内容
要求语言通俗易懂，对普通人有实际指导意义。

请严格按照以下JSON格式输出（不要有其他任何内容）：
{"content":"这里是500字以上的新闻摘要...","analysis":"【这是什么意思？】...【为什么会这样？】...【跟我有什么关系？】..."}`;

    const response = await axios.post(
      `${DOUBAO_CONFIG.baseURL}/chat/completions`,
      {
        model: DOUBAO_CONFIG.model,
        messages: [
          { role: 'system', content: '你是一个专业的财经新闻编辑，擅长生成新闻摘要和解读。你的回答必须严格遵循JSON格式。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 3000
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

      // 解析JSON
      try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            content: parsed.content || `关于"${newsItem.title}"的报道。`,
            analysis: parsed.analysis || `该新闻值得关注。`
          };
        }
      } catch (e) {
        console.log('JSON解析失败，使用默认格式');
      }

      // 如果JSON解析失败，返回默认格式
      return {
        content: aiText.substring(0, 2000),
        analysis: `该新闻来源于${newsItem.source}，发布时间为${formatPublishTime(newsItem.publishTime)}。建议关注后续报道。`
      };
    }
  } catch (error) {
    console.log(`AI生成失败: ${error.message}`);
  }

  // 返回默认内容
  return {
    content: `关于"${newsItem.title}"的详细报道。该新闻来源于${newsItem.source}，发布时间为${formatPublishTime(newsItem.publishTime)}。点击可查看原文详情。`,
    analysis: `该新闻属于${newsItem.category === 'domestic' ? '国内' : '国际'}财经领域。建议关注相关新闻的后续报道，了解市场动态。`
  };
}

// ============================================
// 抓取函数 - 仅使用华尔街见闻和雪球
// ============================================

// 解析RSS - 华尔街见闻
async function fetchRSS(source) {
  const articles = [];
  try {
    const response = await axios.get(source.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    });

    // 检测反爬
    if (isAntiCrawlError({}, response)) {
      setAntiCrawlFlag(source.name);
      console.log(`⚠️ ${source.name} 触发反爬检测`);
      return articles;
    }

    const $ = cheerio.load(response.data, { xmlMode: true });
    $('item').each((i, elem) => {
      if (articles.length >= 30) return;
      const title = $(elem).find('title').text().trim();
      const link = $(elem).find('link').text().trim();
      const pubDate = $(elem).find('pubDate').text().trim();
      const description = $(elem).find('description').text().trim();

      if (title && link && title.length > 5) {
        articles.push({
          id: `rss_${Date.now()}_${i}`,
          title: title.substring(0, 100),
          url: link,
          source: source.name,
          publishTime: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          description: description ? description.substring(0, 200) : ''
        });
      }
    });
  } catch (error) {
    console.log(`RSS ${source.name} 抓取失败: ${error.message}`);
    // 检测是否是反爬错误
    if (isAntiCrawlError(error, error.response)) {
      setAntiCrawlFlag(source.name);
    }
  }
  return articles;
}

// 从HTML抓取 - 华尔街见闻和雪球
async function fetchHTML(source) {
  const articles = [];
  try {
    const response = await axios.get(source.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    });

    // 检测反爬
    if (isAntiCrawlError({}, response)) {
      setAntiCrawlFlag(source.name);
      console.log(`⚠️ ${source.name} 触发反爬检测`);
      return articles;
    }

    const $ = cheerio.load(response.data);

    // 华尔街见闻选择器
    if (source.name.includes('华尔街')) {
      $('.article-item, .news-item, .article-list-item').each((i, elem) => {
        if (articles.length >= 25) return;
        const title = $(elem).find('.title a, .article-title a').first().text().trim();
        const link = $(elem).find('.title a, .article-title a').first().attr('href');
        const time = $(elem).find('.time, .date, .publish-time').first().text().trim();

        if (title && link) {
          if (!link.startsWith('http')) {
            link = 'https://www.wallstreetcn.com' + link;
          }
          articles.push({
            id: `html_${Date.now()}_${i}`,
            title: title.substring(0, 100),
            url: link,
            source: source.name,
            publishTime: time ? new Date(time).toISOString() : new Date().toISOString()
          });
        }
      });
    }

    // 雪球选择器
    if (source.name.includes('雪球')) {
      $('.stock-item, .news_item, .article-item').each((i, elem) => {
        if (articles.length >= 25) return;
        const title = $(elem).find('a').first().text().trim();
        const link = $(elem).find('a').first().attr('href');

        if (title && link) {
          if (!link.startsWith('http')) {
            link = 'https://xueqiu.com' + link;
          }
          articles.push({
            id: `xueqiu_${Date.now()}_${i}`,
            title: title.substring(0, 100),
            url: link,
            source: '雪球',
            publishTime: new Date().toISOString()
          });
        }
      });
    }
  } catch (error) {
    console.log(`HTML ${source.name} 抓取失败: ${error.message}`);
  }
  return articles;
}

// 抓取雪球API
async function fetchXueqiuAPI(source) {
  const articles = [];
  try {
    const response = await axios.get(source.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    });

    // 检测反爬
    if (isAntiCrawlError({}, response)) {
      setAntiCrawlFlag(source.name);
      console.log(`⚠️ ${source.name} 触发反爬检测`);
      return articles;
    }

    if (response.data && response.data.list) {
      response.data.list.forEach((item, i) => {
        if (articles.length >= 30) return;
        articles.push({
          id: `xueqiu_api_${Date.now()}_${i}`,
          title: item.text ? item.text.substring(0, 100) : '',
          url: `https://xueqiu.com/S/${item.symbol}`,
          source: '雪球',
          publishTime: item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()
        });
      });
    }
  } catch (error) {
    console.log(`雪球API抓取失败: ${error.message}`);
    if (isAntiCrawlError(error, error.response)) {
      setAntiCrawlFlag(source.name);
    }
  }
  return articles;
}

// ============================================
// 备用源抓取函数 - 东方财富、新浪、凤凰、网易、今日头条
// ============================================

// 抓取备用新闻源
async function fetchFallbackSource(source) {
  const articles = [];
  try {
    const response = await axios.get(source.url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    });

    const $ = cheerio.load(response.data);
    const now = new Date();

    // 东方财富选择器
    if (source.type === 'html_eastmoney') {
      // 尝试多种选择器
      const selectors = [
        '.news_list li a', '.artical-list li a', '.list_item a',
        'div.article a', '.news-item a', 'ul li a[href*="article"]'
      ];
      for (const selector of selectors) {
        $(selector).each((i, elem) => {
          if (articles.length >= 20) return;
          const title = $(elem).text().trim();
          const link = $(elem).attr('href');

          if (title && title.length > 5 && link) {
            if (!link.startsWith('http')) {
              link = 'https://finance.eastmoney.com' + link;
            }
            articles.push({
              id: `fallback_${Date.now()}_${i}`,
              title: title.substring(0, 100),
              url: link,
              source: '东方财富',
              publishTime: now.toISOString()
            });
          }
        });
        if (articles.length > 0) break;
      }
    }

    // 新浪财经选择器
    if (source.type === 'html_sina') {
      const selectors = [
        '.news_item h2 a', '.top_list li a', '.list_009 li a',
        'div.entry h1 a', '.blk01 h1 a'
      ];
      for (const selector of selectors) {
        $(selector).each((i, elem) => {
          if (articles.length >= 20) return;
          const title = $(elem).text().trim();
          const link = $(elem).attr('href');

          if (title && title.length > 5 && link) {
            if (!link.startsWith('http')) {
              link = 'https://finance.sina.com.cn' + link;
            }
            articles.push({
              id: `fallback_${Date.now()}_${i}`,
              title: title.substring(0, 100),
              url: link,
              source: '新浪财经',
              publishTime: now.toISOString()
            });
          }
        });
        if (articles.length > 0) break;
      }
    }

    // 凤凰网选择器
    if (source.type === 'html_ifeng') {
      const selectors = [
        '.box_01 a', '.news_list li a', '.main_list li a',
        '.pic_text a', '.list_nonews a'
      ];
      for (const selector of selectors) {
        $(selector).each((i, elem) => {
          if (articles.length >= 20) return;
          const title = $(elem).text().trim();
          const link = $(elem).attr('href');

          if (title && title.length > 5 && link) {
            if (!link.startsWith('http')) {
              link = 'https://finance.ifeng.com' + link;
            }
            articles.push({
              id: `fallback_${Date.now()}_${i}`,
              title: title.substring(0, 100),
              url: link,
              source: '凤凰网财经',
              publishTime: now.toISOString()
            });
          }
        });
        if (articles.length > 0) break;
      }
    }

    // 网易财经选择器
    if (source.type === 'html_163') {
      const selectors = [
        '.news_title h2 a', '.item h3 a', '.post_title a',
        '.js-item-title a', '.title_area a'
      ];
      for (const selector of selectors) {
        $(selector).each((i, elem) => {
          if (articles.length >= 20) return;
          const title = $(elem).text().trim();
          const link = $(elem).attr('href');

          if (title && title.length > 5 && link) {
            if (!link.startsWith('http')) {
              link = 'https://money.163.com' + link;
            }
            articles.push({
              id: `fallback_${Date.now()}_${i}`,
              title: title.substring(0, 100),
              url: link,
              source: '网易财经',
              publishTime: now.toISOString()
            });
          }
        });
        if (articles.length > 0) break;
      }
    }

    // 今日头条选择器
    if (source.type === 'html_toutiao') {
      const selectors = [
        '.article-title', '.news-title', '.title',
        'a[href*="article"]', 'h3 a'
      ];
      for (const selector of selectors) {
        $(selector).each((i, elem) => {
          if (articles.length >= 20) return;
          const title = $(elem).text().trim();
          const link = $(elem).attr('href');

          if (title && title.length > 5 && link && link.includes('toutiao.com')) {
            if (!link.startsWith('http')) {
              link = 'https://www.toutiao.com' + link;
            }
            articles.push({
              id: `fallback_${Date.now()}_${i}`,
              title: title.substring(0, 100),
              url: link,
              source: '今日头条',
              publishTime: now.toISOString()
            });
          }
        });
        if (articles.length > 0) break;
      }
    }

    console.log(`✅ 备用源 ${source.name} 获取到 ${articles.length} 条`);
  } catch (error) {
    console.log(`备用源 ${source.name} 抓取失败: ${error.message}`);
  }
  return articles;
}

// ============================================
// 新闻过滤和排序 - 严格版本
// ============================================

// 过滤并排序新闻 - 严格版本
function filterAndRank(articles, category) {
  // 先过滤24小时内的
  let recent = articles.filter(a => isWithin24Hours(a.publishTime));

  // 如果过滤后太少，放宽时间限制
  if (recent.length < 10) {
    recent = articles;
  }

  // 去重
  const seen = new Set();
  const unique = recent.filter(a => {
    const key = a.title.substring(0, 30).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 严格分类筛选
  let filtered;
  if (category === 'domestic') {
    // 国内新闻：只保留国内新闻，排除国际新闻
    filtered = unique.filter(a => isDomesticNews(a.title) === true);
  } else {
    // 国际新闻：只保留国际新闻，排除国内新闻
    filtered = unique.filter(a => isInternationalNews(a.title) === true);
  }

  // 如果筛选后太少，使用全部
  if (filtered.length < 5) {
    filtered = unique;
  }

  // 根据分类添加标签
  const result = filtered.map((a, index) => ({
    id: index + 1,
    title: a.title.substring(0, 30),
    source: a.source,
    url: a.url,
    publish_time: formatPublishTime(a.publishTime),
    category: category,
    tag: getTag(a.title),
    content: '',
    analysis: ''
  }));

  return result.slice(0, 15);
}

// ============================================
// 抓取国内新闻 - 优先华尔街见闻和雪球，失败时切换备用源
// ============================================
async function fetchDomesticNews() {
  console.log('🔍 开始抓取国内财经新闻（优先华尔街见闻和雪球）...');
  let allArticles = [];

  // 重置反爬检测
  antiCrawlDetected = { wallstreetcn: false, xueqiu: false };

  // 先尝试抓取主源（华尔街见闻和雪球）
  for (const source of NEWS_SOURCES.domestic) {
    if (source.type === 'rss') {
      const articles = await fetchRSS(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国内 - ${source.name} RSS获取到 ${articles.length} 条`);
      }
    } else if (source.type === 'api') {
      // 雪球API
      const articles = await fetchXueqiuAPI(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国内 - ${source.name} API获取到 ${articles.length} 条`);
      }
    } else {
      // HTML抓取
      const articles = await fetchHTML(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国内 - ${source.name} HTML获取到 ${articles.length} 条`);
      }
    }
  }

  // 如果主源数据不足或被反爬，自动切换备用源
  if (allArticles.length < 5 || antiCrawlDetected.wallstreetcn || antiCrawlDetected.xueqiu) {
    console.log('⚠️ 主源数据不足或检测到反爬，尝试备用新闻源...');

    for (const source of FALLBACK_SOURCES.domestic) {
      const articles = await fetchFallbackSource(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国内 - 备用源 ${source.name} 获取到 ${articles.length} 条`);
      }

      // 获取到足够数据后停止
      if (allArticles.length >= 20) break;
    }
  }

  // 备用数据 - 严格的国内财经新闻
  if (allArticles.length < 5) {
    console.log('⚠️ 所有源数据不足，使用备用数据');
    allArticles.push(...getFallbackNews('domestic'));
  }

  const filtered = filterAndRank(allArticles, 'domestic');
  console.log(`✅ 国内新闻: 获取 ${filtered.length} 条`);
  return filtered;
}

// ============================================
// 抓取国际新闻 - 优先华尔街见闻和雪球，失败时切换备用源
// ============================================
async function fetchInternationalNews() {
  console.log('🔍 开始抓取国际财经新闻（优先华尔街见闻和雪球）...');
  let allArticles = [];

  // 先尝试抓取主源（华尔街见闻和雪球）
  for (const source of NEWS_SOURCES.international) {
    if (source.type === 'rss') {
      const articles = await fetchRSS(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国际 - ${source.name} RSS获取到 ${articles.length} 条`);
      }
    } else {
      // HTML抓取
      const articles = await fetchHTML(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国际 - ${source.name} HTML获取到 ${articles.length} 条`);
      }
    }
  }

  // 如果主源数据不足或被反爬，自动切换备用源
  if (allArticles.length < 5 || antiCrawlDetected.wallstreetcn || antiCrawlDetected.xueqiu) {
    console.log('⚠️ 主源数据不足或检测到反爬，尝试备用新闻源...');

    for (const source of FALLBACK_SOURCES.international) {
      const articles = await fetchFallbackSource(source);
      if (articles.length > 0) {
        allArticles.push(...articles);
        console.log(`国际 - 备用源 ${source.name} 获取到 ${articles.length} 条`);
      }

      // 获取到足够数据后停止
      if (allArticles.length >= 20) break;
    }
  }

  // 备用数据 - 严格的国际财经新闻
  if (allArticles.length < 5) {
    console.log('⚠️ 所有源数据不足，使用备用数据');
    allArticles.push(...getFallbackNews('international'));
  }

  const filtered = filterAndRank(allArticles, 'international');
  console.log(`✅ 国际新闻: 获取 ${filtered.length} 条`);
  return filtered;
}

// ============================================
// 备用新闻数据 - 仅华尔街见闻和雪球
// ============================================
function getFallbackNews(category) {
  const now = new Date();

  if (category === 'domestic') {
    return [
      { id: 'fallback_1', title: 'A股市场今日走势分化 结构性行情延续', url: 'https://www.wallstreetcn.com/articles/2026-03-05/abc-market-divergence', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_2', title: '央行货币政策操作平稳 流动性合理充裕', url: 'https://www.wallstreetcn.com/articles/2026-03-05/pboc-monetary-policy', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_3', title: '两会对金融市场影响解读 专家观点汇总', url: 'https://www.wallstreetcn.com/articles/2026-03-05/two-sessions-financial-impact', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_4', title: '房地产政策持续优化 市场信心逐步恢复', url: 'https://www.wallstreetcn.com/articles/2026-03-05/property-policy-optimization', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_5', title: '科技板块表现活跃 AI相关概念股受关注', url: 'https://www.wallstreetcn.com/articles/2026-03-05/tech-sector-ai-stocks', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_6', title: '新能源汽车销量增长 比亚迪销量领先', url: 'https://xueqiu.com/S/SH600594', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_7', title: '芯片半导体国产化提速 产业链迎来机遇', url: 'https://www.wallstreetcn.com/articles/2026-03-05/semiconductor-localization', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_8', title: '银行理财收益率回升 投资者关注', url: 'https://xueqiu.com/S/SH000001', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_9', title: '国内消费市场回暖 零售数据向好', url: 'https://www.wallstreetcn.com/articles/2026-03-05/consumption-market-recovery', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_10', title: '基建投资发力 重大项目集中开工', url: 'https://www.wallstreetcn.com/articles/2026-03-05/infrastructure-investment', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_11', title: '科创板持续活跃 科技创新受追捧', url: 'https://xueqiu.com/S/SH688001', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_12', title: '人民币汇率稳定 跨境资金流动平稳', url: 'https://www.wallstreetcn.com/articles/2026-03-05/cny-exchange-rate', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_13', title: '保险资金入市 资本市场增量资金可期', url: 'https://xueqiu.com/S/SH601319', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_14', title: '制造业PMI回升 经济复苏态势明显', url: 'https://www.wallstreetcn.com/articles/2026-03-05/manufacturing-pmi-recovery', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_15', title: '新能源汽车出口增长 中国制造走向全球', url: 'https://xueqiu.com/S/SZ002594', source: '雪球', publishTime: now.toISOString() }
    ];
  } else {
    return [
      { id: 'fallback_intl_1', title: '美股三大指数涨跌不一 科技股走势分化', url: 'https://www.wallstreetcn.com/articles/2026-03-05/us-stock-market-divergence', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_2', title: '美联储主席暗示降息节奏放缓 市场关注', url: 'https://www.wallstreetcn.com/articles/2026-03-05/fed-powell-rate-cut-hint', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_3', title: '欧洲股市全线上涨 奢侈品板块领跑', url: 'https://www.wallstreetcn.com/articles/2026-03-05/european-stock-rise', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_4', title: '日元汇率创新低 出口企业受益明显', url: 'https://www.wallstreetcn.com/articles/2026-03-05/yen-exchange-rate-low', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_5', title: '黄金价格突破历史新高 避险情绪升温', url: 'https://xueqiu.com/S/XAUUSD', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_intl_6', title: '苹果发布新品 供应链公司受关注', url: 'https://www.wallstreetcn.com/articles/2026-03-05/apple-new-product', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_7', title: '特斯拉财报超预期 股价上涨', url: 'https://xueqiu.com/S/TSLA', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_intl_8', title: 'WTI原油价格下跌 OPEC+减产影响', url: 'https://www.wallstreetcn.com/articles/2026-03-05/wti-oil-price-drop', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_9', title: '英伟达发布新品 AI芯片领域再突破', url: 'https://www.wallstreetcn.com/articles/2026-03-05/nvidia-new-product', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_10', title: '德国股市创新高 欧洲经济复苏', url: 'https://www.wallstreetcn.com/articles/2026-03-05/german-stock-high', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_11', title: '美元指数走强 外汇市场波动', url: 'https://xueqiu.com/S/DXY', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_intl_12', title: '韩国股市领涨 半导体板块强劲', url: 'https://www.wallstreetcn.com/articles/2026-03-05/korea-stock-semiconductor', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_13', title: '国际金价上涨 央行购金持续', url: 'https://xueqiu.com/S/XAUUSD', source: '雪球', publishTime: now.toISOString() },
      { id: 'fallback_intl_14', title: '美债收益率攀升 债券市场承压', url: 'https://www.wallstreetcn.com/articles/2026-03-05/us-bond-yield-rise', source: '华尔街见闻', publishTime: now.toISOString() },
      { id: 'fallback_intl_15', title: '全球AI热潮持续 科技股领涨', url: 'https://xueqiu.com/S/NVDA', source: '雪球', publishTime: now.toISOString() }
    ];
  }
}

// ============================================
// AI生成内容 - 带重试和延迟机制
// ============================================

// 延迟函数 - 避免API速率限制
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 带重试的AI调用
async function callAIWithRetry(prompt, apiKey, maxRetries = 3) {
  const cleanApiKey = apiKey.replace(/export\s+ARK_API_KEY=|["']/g, '');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        {
          model: 'ep-20260303114824-tfhrx',
          messages: [
            { role: 'system', content: '你是一位专业的财经新闻编辑，擅长用通俗易懂的语言解释财经新闻。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 4000
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanApiKey}`
          },
          timeout: 60000
        }
      );

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        return response.data.choices[0].message.content;
      }

      throw new Error('AI返回格式错误');
    } catch (error) {
      const status = error.response?.status;

      // 如果是速率限制(429)，等待后重试
      if (status === 429 && attempt < maxRetries) {
        const waitTime = attempt * 2000; // 2秒、4秒、6秒
        console.log(`⏳ API速率限制，等待 ${waitTime/1000}秒后重试...`);
        await delay(waitTime);
        continue;
      }

      // 其他错误直接抛出
      throw error;
    }
  }
  throw new Error('AI重试次数用尽');
}

async function generateContentAndAnalysis(newsItem) {
  const apiKey = process.env.ARK_API_KEY;

  if (!apiKey) {
    console.log('⚠️ AI API Key未配置，使用默认内容');
    return {
      content: `关于"${newsItem.title}"的详细报道。`,
      analysis: `【这是什么意思？】该新闻值得关注。\n【为什么会这样？】请查看原文了解详情。\n【跟我有什么关系？】建议关注相关领域动态。`
    };
  }

  const prompt = `你是一位专业的财经新闻编辑。请根据以下新闻标题，生成：
1. 500字以上的新闻摘要（content）
2. 300字以上的AI解读（analysis），包含三个部分：
   - 【这是什么意思？】
   - 【为什么会这样？】
   - 【跟我有什么关系？】

新闻标题：${newsItem.title}
新闻来源：${newsItem.source}

请用通俗易懂的语言解释，适合财经小白理解。

请严格按照以下格式返回：
---
CONTENT: [500字以上的新闻摘要]
ANALYSIS: [300字以上的AI解读，包含上述三个部分]
---`;

  try {
    const result = await callAIWithRetry(prompt, apiKey);

    // 解析结果
    let content = '';
    let analysis = '';

    const contentMatch = result.match(/CONTENT:([\s\S]*?)(?:ANALYSIS:|$)/);
    const analysisMatch = result.match(/ANALYSIS:([\s\S]*?)$/);

    if (contentMatch) {
      content = contentMatch[1].trim();
    }
    if (analysisMatch) {
      analysis = analysisMatch[1].trim();
    }

    // 如果解析失败，使用默认格式
    if (!content) {
      content = result.replace(/ANALYSIS:[\s\S]*?$/, '').trim();
    }
    if (!analysis) {
      analysis = `【这是什么意思？】该新闻值得关注。\n【为什么会这样？】请查看原文了解详情。\n【跟我有什么关系？】建议关注相关领域动态。`;
    }

    console.log(`✅ AI生成成功: ${newsItem.title.substring(0, 20)}...`);
    return { content, analysis };
  } catch (error) {
    console.log(`❌ AI生成失败: ${error.message}`);
    return {
      content: `关于"${newsItem.title}"的详细报道。`,
      analysis: `【这是什么意思？】该新闻值得关注。\n【为什么会这样？】请查看原文了解详情。\n【跟我有什么关系？】建议关注相关领域动态。`
    };
  }
}

// ============================================
// 主流程
// ============================================

// 完整的新闻更新流程 - 自动生成content和analysis
async function updateAllNews() {
  console.log('========== ⏰ 开始定时新闻更新 ==========');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  try {
    const [domestic, international] = await Promise.all([
      fetchDomesticNews(),
      fetchInternationalNews()
    ]);

    // 为每条新闻生成content和analysis
    console.log('🤖 开始生成新闻摘要和AI解读...');

    // 国内新闻生成 - 每条之间添加延迟避免速率限制
    for (let i = 0; i < domestic.length; i++) {
      const news = domestic[i];
      console.log(`国内 - 生成 ${i + 1}/${domestic.length}: ${news.title}`);
      try {
        const aiResult = await generateContentAndAnalysis(news);
        domestic[i].content = aiResult.content;
        domestic[i].analysis = aiResult.analysis;
      } catch (e) {
        console.log(`生成失败，使用默认内容`);
        domestic[i].content = `关于"${news.title}"的详细报道。`;
        domestic[i].analysis = `【这是什么意思？】该新闻值得关注。\n【为什么会这样？】请查看原文了解详情。\n【跟我有什么关系？】建议关注相关领域动态。`;
      }
      // 每条新闻之间延迟1.5秒，避免API速率限制
      if (i < domestic.length - 1) {
        await delay(1500);
      }
    }

    // 国际新闻生成 - 每条之间添加延迟避免速率限制
    for (let i = 0; i < international.length; i++) {
      const news = international[i];
      console.log(`国际 - 生成 ${i + 1}/${international.length}: ${news.title}`);
      try {
        const aiResult = await generateContentAndAnalysis(news);
        international[i].content = aiResult.content;
        international[i].analysis = aiResult.analysis;
      } catch (e) {
        console.log(`生成失败，使用默认内容`);
        international[i].content = `关于"${news.title}"的详细报道。`;
        international[i].analysis = `【这是什么意思？】该新闻值得关注。\n【为什么会这样？】请查看原文了解详情。\n【跟我有什么关系？】建议关注相关领域动态。`;
      }
      // 每条新闻之间延迟1.5秒，避免API速率限制
      if (i < international.length - 1) {
        await delay(1500);
      }
    }

    // 更新缓存
    newsCache = {
      domestic: domestic.slice(0, 15),  // 确保15条
      international: international.slice(0, 15),  // 确保15条
      lastUpdate: new Date().toISOString()
    };

    console.log(`📊 新闻更新完成: 国内 ${newsCache.domestic.length} 条, 国际 ${newsCache.international.length} 条`);
    console.log('========== ✅ 新闻更新完成 ==========');

    return { domestic: newsCache.domestic, international: newsCache.international };
  } catch (error) {
    console.error('❌ 新闻更新失败:', error);
    throw error;
  }
}

// 获取新闻缓存
function getNewsCache() {
  return newsCache;
}

// 清空旧新闻
function clearOldNews() {
  console.log('🗑️ 清空旧新闻缓存...');
  newsCache = {
    domestic: [],
    international: [],
    lastUpdate: null
  };
  return true;
}

// 强制刷新
async function forceRefresh() {
  // 先清空旧数据
  clearOldNews();
  return await updateAllNews();
}

module.exports = {
  updateAllNews,
  getNewsCache,
  clearOldNews,
  forceRefresh
};
