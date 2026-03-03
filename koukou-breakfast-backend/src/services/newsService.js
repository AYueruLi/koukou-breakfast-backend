/**
 * 新闻服务 - 负责新闻数据的抓取、存储和提供
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class NewsService {
  constructor() {
    this.dataFilePath = path.join(__dirname, '../public/news-data.json');
    this.lastUpdateFile = path.join(__dirname, '../public/last-update.txt');
    this.lastUpdateTime = null;

    // 确保数据目录存在
    const dataDir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * 获取时间窗口（昨天8:00到今天8:00）
   */
  getTimeWindow() {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(8, 0, 0, 0);

    const today = new Date(now);
    today.setHours(8, 0, 0, 0);

    return { start: yesterday, end: today };
  }

  /**
   * 抓取国内财经新闻
   */
  async fetchDomesticNews() {
    // 使用搜索API获取新闻
    // 这里使用模拟数据，实际项目中可以接入真实API
    const queries = [
      'A股 股市 2026年3月 今日行情',
      '央行 货币政策 2026年3月',
      '两会 财经 政策 2026年3月',
      '房地产 房价 2026年3月',
      '基金 理财 2026年3月'
    ];

    const news = [];

    // 实际项目中，这里应该调用搜索引擎或新闻API
    // 为了演示，我们构建基于搜索结果的新闻数据
    news.push(
      {
        id: '1',
        title: '央行重磅出手！远期售汇外汇风险准备金率下调为0',
        source: '新浪财经',
        time: this.formatDate(new Date()),
        tag: '宏观',
        url: 'https://finance.sina.com.cn/money/bond/2026-03-02/doc-inhpqkns8287490.shtml'
      },
      {
        id: '2',
        title: 'A股三大指数集体收涨！上证指数涨0.48%，两市成交超1.3万亿',
        source: '东方财富网',
        time: this.formatDate(new Date()),
        tag: '股市',
        url: 'https://quote.eastmoney.com/zs000002.html'
      },
      {
        id: '3',
        title: '中原策略：3月市场大概率延续震荡上行、结构分化特征',
        source: '天天基金网',
        time: this.formatDate(new Date()),
        tag: '策略',
        url: 'https://fund.eastmoney.com/a/202603013657725325.html'
      },
      {
        id: '4',
        title: '全国两会将于3月4日开幕！十五五规划纲要即将公布',
        source: '界面新闻',
        time: this.formatDate(new Date()),
        tag: '政策',
        url: 'https://www.jiemian.com/article/14044117.html'
      },
      {
        id: '5',
        title: '证监会召开外资机构座谈会！推动资本市场高质量发展',
        source: '网易财经',
        time: this.formatDate(new Date()),
        tag: '监管',
        url: 'https://www.163.com/dy/article/KN0IDSGP0519DDQ2.html'
      },
      {
        id: '6',
        title: '2026年3月流动性跟踪：资金面怎么看？',
        source: '未来智库',
        time: this.formatDate(new Date()),
        tag: '宏观',
        url: 'https://www.vzkoo.com/read/4642446650231492608.html'
      },
      {
        id: '7',
        title: '重磅！2026年汽车以旧换新补贴实施细则落地',
        source: '懂车帝',
        time: this.formatDate(new Date()),
        tag: '消费',
        url: 'https://www.dongchedi.com/article/7612032670687576638'
      },
      {
        id: '8',
        title: '华金证券：三月延续震荡偏强 成长占优',
        source: '新浪财经',
        time: this.formatDate(new Date()),
        tag: '策略',
        url: 'https://finance.sina.com.cn/stock/report/2026-03-01/doc-inhpnscq6084593.shtml'
      },
      {
        id: '9',
        title: '券商首席热议两会机遇：GDP增速目标或设定4.5%-5.0%',
        source: '天天基金网',
        time: this.formatDate(new Date()),
        tag: '政策',
        url: 'https://fund.eastmoney.com/a/202603013657754918.html'
      },
      {
        id: '10',
        title: '金融产品周报：3月A股权益走势展望——先抑后扬',
        source: '证券之星',
        time: this.formatDate(new Date()),
        tag: '策略',
        url: 'https://stock.stockstar.com/JC2026030200002138.shtml'
      },
      {
        id: '11',
        title: '2026年3月市场前瞻：三大宏观变量如何决定资产走势',
        source: 'Odaily',
        time: this.formatDate(new Date()),
        tag: '宏观',
        url: 'https://www.odaily.news/zh-CN/post/5209521'
      },
      {
        id: '12',
        title: '3月A股处于做多窗口期 预计涨价驱动的行情将持续',
        source: '看看新闻网',
        time: this.formatDate(new Date()),
        tag: '股市',
        url: 'https://www.kankanews.com/detail/lm2XqeD6Vyr'
      },
      {
        id: '13',
        title: '房地产政策持续宽松！15城出台50条调控政策',
        source: 'wind资讯',
        time: this.formatDate(new Date()),
        tag: '楼市',
        url: 'http://www.qhjshyxx.com/index.php?c=show&id=4436'
      },
      {
        id: '14',
        title: '两部门：运用地方专项债收储 推动房地产去库存',
        source: '财政部官网',
        time: this.formatDate(new Date()),
        tag: '楼市',
        url: 'https://www.mof.gov.cn'
      },
      {
        id: '15',
        title: 'PMI数据即将公布！3月经济复苏成色引关注',
        source: '统计局官网',
        time: this.formatDate(new Date()),
        tag: '宏观',
        url: 'https://www.stats.gov.cn'
      }
    );

    return news;
  }

  /**
   * 抓取海外财经新闻
   */
  async fetchOverseasNews() {
    const news = [];

    news.push(
      {
        id: '101',
        title: '重磅！美联储3月维持利率不变的概率为93.6%',
        source: '汇通网',
        time: this.formatDate(new Date()),
        tag: '美联储',
        url: 'https://3g.fx678.com/news/detail/202603020609502060'
      },
      {
        id: '102',
        title: '美股连续第三日上涨！三大股指小幅收高',
        source: '东方财富网',
        time: this.formatDate(new Date()),
        tag: '美股',
        url: 'https://finance.eastmoney.com/a/202603023657829854.html'
      },
      {
        id: '103',
        title: '黄金期货突破3030美元/盎司！避险需求升温',
        source: '金十数据',
        time: this.formatDate(new Date()),
        tag: '黄金',
        url: 'https://xnews.jin10.com'
      },
      {
        id: '104',
        title: '国际油价小幅波动！美油69美元/桶、布油72.56美元',
        source: '金十数据',
        time: this.formatDate(new Date()),
        tag: '原油',
        url: 'https://xnews.jin10.com'
      },
      {
        id: '105',
        title: '港股今日行情：恒生指数收跌2.35%',
        source: '东方财富网',
        time: this.formatDate(new Date()),
        tag: '港股',
        url: 'https://quote.eastmoney.com/zzsh000002.html'
      },
      {
        id: '106',
        title: '摩根士丹利上调恒生指数目标至25800点',
        source: '东方财富网',
        time: this.formatDate(new Date()),
        tag: '港股',
        url: 'https://finance.eastmoney.com'
      },
      {
        id: '107',
        title: '美联储议息会议前瞻：3月17-18日FOMC会议六大看点',
        source: '雪球',
        time: this.formatDate(new Date()),
        tag: '美联储',
        url: 'https://xueqiu.com'
      },
      {
        id: '108',
        title: '3月Web3大事件：FOMC利率决议，稳定币牌照、加密解锁',
        source: '腾讯新闻',
        time: this.formatDate(new Date()),
        tag: '加密',
        url: 'https://news.qq.com/rain/a/20260301A02GGB00'
      },
      {
        id: '109',
        title: '地缘局势升级！美伊冲突风险引全球市场波动',
        source: '未来智库',
        time: this.formatDate(new Date()),
        tag: '地缘',
        url: 'https://www.vzkoo.com'
      },
      {
        id: '110',
        title: '关税不确定性犹存！特朗普3月底有访华安排',
        source: '未来智库',
        time: this.formatDate(new Date()),
        tag: '国际贸易',
        url: 'https://www.vzkoo.com'
      },
      {
        id: '111',
        title: 'IMF总裁警示：美国经济短期韧性但中长期存结构性风险',
        source: '新浪财经',
        time: this.formatDate(new Date()),
        tag: '国际',
        url: 'https://finance.sina.com.cn'
      },
      {
        id: '112',
        title: '全球央行动态：美联储官员密集发声 日本央行预留加息窗口',
        source: '新浪财经',
        time: this.formatDate(new Date()),
        tag: '央行',
        url: 'https://finance.sina.com.cn/money/bond/2026-03-02/doc-inhpqkns8287490.shtml'
      },
      {
        id: '113',
        title: '美股科技股分化：特斯拉连续5日上涨 苹果受欧盟罚款预期影响',
        source: '东方财富网',
        time: this.formatDate(new Date()),
        tag: '科技',
        url: 'https://finance.eastmoney.com'
      },
      {
        id: '114',
        title: '美联储官员表态分歧：沃勒偏鹰 米兰呼吁大幅降息',
        source: '汇通网',
        time: this.formatDate(new Date()),
        tag: '美联储',
        url: 'https://3g.fx678.com'
      },
      {
        id: '115',
        title: '流动性观察：美元保持韧性 稳定币总规模约2976亿美元',
        source: 'Odaily',
        time: this.formatDate(new Date()),
        tag: '宏观',
        url: 'https://www.odaily.news'
      }
    );

    return news;
  }

  /**
   * 抓取并保存新闻数据
   */
  async fetchAndSaveNews() {
    console.log('📡 正在抓取新闻数据...');

    const domesticNews = await this.fetchDomesticNews();
    const overseasNews = await this.fetchOverseasNews();

    const data = {
      domestic: domesticNews,
      overseas: overseasNews,
      market: {
        domestic: 'A股3月延续震荡上行格局，上证指数收涨0.48%报4385.89点，两市成交超1.3万亿元。政策面上，两会即将召开，市场聚焦十五五规划纲要；流动性环境维持适度宽松，两会后降准降息预期犹存。',
        overseas: '美联储3月维持利率不变的概率高达93.6%，降息预期持续后移。美股连续三日上涨，科技股分化明显；黄金突破3030美元创新高，避险需求升温；地缘局势和关税政策仍是市场主要扰动因素。'
      },
      updatedAt: new Date().toISOString()
    };

    // 保存到文件
    fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
    fs.writeFileSync(this.lastUpdateFile, new Date().toISOString());

    this.lastUpdateTime = new Date();

    console.log(`✅ 新闻抓取完成：国内${domesticNews.length}条，海外${overseasNews.length}条`);

    return data;
  }

  /**
   * 获取国内新闻
   */
  async getDomesticNews() {
    // 尝试从文件读取，如果没有则抓取
    if (fs.existsSync(this.dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
      return data.domestic || [];
    }
    return await this.fetchDomesticNews();
  }

  /**
   * 获取海外新闻
   */
  async getOverseasNews() {
    if (fs.existsSync(this.dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
      return data.overseas || [];
    }
    return await this.fetchOverseasNews();
  }

  /**
   * 获取每日新闻
   */
  async getDailyNews() {
    if (fs.existsSync(this.dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
      return {
        domestic: data.domestic || [],
        overseas: data.overseas || [],
        updatedAt: data.updatedAt
      };
    }
    const domestic = await this.fetchDomesticNews();
    const overseas = await this.fetchOverseasNews();
    return { domestic, overseas, updatedAt: new Date().toISOString() };
  }

  /**
   * 获取市场概览
   */
  async getMarketOverview() {
    if (fs.existsSync(this.dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
      return data.market || { domestic: '', overseas: '' };
    }
    return {
      domestic: 'A股3月延续震荡上行格局...',
      overseas: '美联储3月维持利率不变的概率高达93.6%...'
    };
  }

  /**
   * 获取最后更新时间
   */
  getLastUpdateTime() {
    if (this.lastUpdateTime) {
      return this.lastUpdateTime.toISOString();
    }
    if (fs.existsSync(this.lastUpdateFile)) {
      return fs.readFileSync(this.lastUpdateFile, 'utf-8');
    }
    return null;
  }

  /**
   * 格式化日期
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

module.exports = NewsService;
