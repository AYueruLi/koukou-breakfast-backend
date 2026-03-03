/**
 * 豆包AI服务 - 提供智能问答功能
 */

const axios = require('axios');

// 豆包API配置
const DOUBAO_CONFIG = {
  // 使用火山引擎方舟大模型API
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'ep-20260303114824-tfhrx', // 豆包pro 32K模型
};

// 系统提示词 - 让AI扮演财经小白导师
const SYSTEM_PROMPT = `你叫"扣扣AI助手"，是专门帮助财经小白理解复杂财经新闻的AI助手。

你需要用最通俗易懂的语言解释财经新闻中的专业概念、背后的逻辑、政策的影响等。

回答要求：
1. 用生活化的比喻解释专业术语
2. 强调对普通人（老百姓）的影响
3. 保持友好、耐心的语气
4. 如果问题超出新闻范围，礼貌地说明并给出合理建议
5. 回答要简洁明了，避免过于冗长
6. 可以适当使用emoji让回答更生动

你的目标是用小白也能听懂的语言，让每个人都能理解财经新闻。

新闻内容：
{news_content}

新闻标题：{news_title}`;

/**
 * 调用豆包AI API
 */
const callDoubaoAI = async (userQuestion, newsContent, newsTitle) => {
  const apiKey = process.env.ARK_API_KEY;

  if (!apiKey) {
    throw new Error('AI API Key未配置');
  }

  // 清理API Key（移除可能的export和引号）
  const cleanApiKey = apiKey.replace(/export\s+ARK_API_KEY=|["']/g, '');

  // 构建提示词
  const prompt = SYSTEM_PROMPT
    .replace('{news_content}', newsContent)
    .replace('{news_title}', newsTitle);

  try {
    const response = await axios.post(
      `${DOUBAO_CONFIG.baseURL}/chat/completions`,
      {
        model: DOUBAO_CONFIG.model,
        messages: [
          {
            role: 'system',
            content: prompt
          },
          {
            role: 'user',
            content: userQuestion
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        timeout: 30000
      }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    }

    throw new Error('AI返回格式错误');
  } catch (error) {
    console.error('豆包AI调用失败:', error.response?.data || error.message);
    throw new Error(`AI服务调用失败: ${error.message}`);
  }
};

/**
 * 快速问题生成回答
 */
const generateQuickAnswer = (questionType, newsContent, newsTitle) => {
  const quickAnswers = {
    '这篇文章到底在说什么？': `📰 **${newsTitle}**\n\n这是一篇关于财经的重要新闻。让我用简单的话帮你理解：\n\n${newsContent.slice(0, 500)}${newsContent.length > 500 ? '...' : ''}\n\n简单来说，这篇新闻主要讲述了与${extractKeyTopics(newsContent)}相关的重要内容。`,
    '这跟我有什么关系？': `💡 **跟你有什么关系？**\n\n这条新闻可能影响到我们普通人：\n\n${generateImpact(newsContent)}\n\n记住：关注财经新闻可以帮助你更好地管理钱包！`,
    '为什么会出现这种情况？': `🔍 **为什么会这样？**\n\n根据新闻内容，这种情况的发生通常有以下几个原因：\n\n${generateReasons(newsContent)}`,
    '普通人应该注意什么？': `⚠️ **普通人应该注意什么？**\n\n1. 理性看待市场波动，不要盲目跟风\n2. 分散投资风险\n3. 持续学习财经知识\n4. 根据自身情况做决定\n\n记住：不懂不要投，懂了也要谨慎！`
  };

  return quickAnswers[questionType] || null;
};

// 提取新闻关键主题
const extractKeyTopics = (content) => {
  const topics = [];
  const topicKeywords = {
    '央行': '货币政策',
    '降息': '利率变化',
    '加息': '利率变化',
    '股市': '股票市场',
    '房价': '房地产市场',
    '外汇': '汇率变化',
    'CPI': '物价水平',
    'GDP': '经济增长',
    '房地产': '房产市场'
  };

  for (const [keyword, topic] of Object.entries(topicKeywords)) {
    if (content.includes(keyword) && !topics.includes(topic)) {
      topics.push(topic);
    }
  }

  return topics.slice(0, 3).join('、') || '金融市场';
};

// 生成影响说明
const generateImpact = (content) => {
  let impacts = [];

  if (content.includes('降息') || content.includes('利率')) {
    impacts.push('• **借钱成本**：贷款买房、买车的利息可能变化');
    impacts.push('• **存款收益**：存款利率可能调整');
  }

  if (content.includes('股市') || content.includes('A股')) {
    impacts.push('• **投资收益**：股票、基金可能受影响');
    impacts.push('• **工作机会**：就业市场可能变化');
  }

  if (content.includes('房地产') || content.includes('房价')) {
    impacts.push('• **房子价值**：有房一族关注');
    impacts.push('• **租房成本**：租房者关注');
  }

  if (impacts.length === 0) {
    impacts.push('• 关注相关行业发展');
    impacts.push('• 理性看待市场波动');
  }

  return impacts.slice(0, 4).join('\n');
};

// 生成原因说明
const generateReasons = (content) => {
  return `1. 宏观经济环境变化
2. 政策调整影响
3. 市场预期调整
4. 供需关系变化

具体原因需要结合更多信息分析。`;
};

module.exports = {
  callDoubaoAI,
  generateQuickAnswer
};
