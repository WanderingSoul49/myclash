/**
 * Mihomo/Clash JS Override for "Subconverter Replacement"
 * 对应原 .ini 配置文件逻辑
 * 负责路由策略。js 覆盖模块
 * 主要管理节点筛选、策略组、规则集和规则等
 */

function main(config) {
  // ==========================================
  // 1. 基础环境与节点提取
  // ==========================================

  // 获取所有代理节点名称 (排除 DIRECT, REJECT 等内置)
  const allProxies = (config.proxies || []).map(p => p.name)

  // 定义正则匹配工具函数
  const contains = (name, regex) => regex.test(name)
  const notContains = (name, regex) => !regex.test(name)

  // 预定义正则关键字 (对应 ini 中的正则)
  const regHome = /家宽|家庭|住宅|原生/
  const regGame = /游戏/
  const regHK = /香港|HK|Hong Kong|🇭🇰|HongKong/
  const regJP = /日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan/
  const regSG = /新加坡|坡|狮城|SG|Singapore/
  const regUS =
    /美国|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|US|United States/
  const regTW = /台湾|TW|taiwan|台湾地区|Taiwan/
  const regKR = /KR|Korea|KOR|首尔|韩|韓/
  const regAI = /AI/

  // ==========================================
  // 2. 节点筛选 (对应 ini 的正则筛选逻辑)
  // ==========================================

  // 基础地区节点
  const hkNodes = allProxies.filter(n => contains(n, regHK))
  const jpNodes = allProxies.filter(n => contains(n, regJP))
  const sgNodes = allProxies.filter(n => contains(n, regSG))
  const usNodes = allProxies.filter(n => contains(n, regUS))
  const twNodes = allProxies.filter(n => contains(n, regTW))
  const krNodes = allProxies.filter(n => contains(n, regKR))

  // 功能性节点
  const homeNodes = allProxies.filter(n => contains(n, regHome))
  const gameNodes = allProxies.filter(n => contains(n, regGame))

  // 复杂逻辑筛选
  // 对应: custom_proxy_group=♻️ 自动优选`...`(?=.*)^((?!(家宽|家庭|住宅|原生)).)*$
  const autoNodes = allProxies.filter(n => notContains(n, regHome))

  // 对应: custom_proxy_group=🌐 其他地区 (排除主要地区 + 排除家宽)
  const otherNodes = allProxies.filter(
    n =>
      !contains(n, regHK) &&
      !contains(n, regJP) &&
      !contains(n, regSG) &&
      !contains(n, regUS) &&
      !contains(n, regTW) &&
      !contains(n, regKR) &&
      notContains(n, regHome)
  )

  // AI 组合节点 (ini: 节点同时包含地区和 AI 关键字)
  const usAiNodes = allProxies.filter(n => contains(n, regUS) && contains(n, regAI))
  const sgAiNodes = allProxies.filter(n => contains(n, regSG) && contains(n, regAI))
  const krAiNodes = allProxies.filter(n => contains(n, regKR) && contains(n, regAI))
  const jpAiNodes = allProxies.filter(n => contains(n, regJP) && contains(n, regAI))
  const otherAiNodes = allProxies.filter(
    n => contains(n, regAI) && !contains(n, regUS) && !contains(n, regSG) && !contains(n, regKR) && !contains(n, regJP)
  )

  // 兜底防止空组报错 (如果筛选结果为空，塞入 DIRECT 或 REJECT)
  const fallback = list => (list.length > 0 ? list : ['DIRECT'])

  // ==========================================
  // 3. 定义策略组 (Proxy Groups)
  // ==========================================

  // 常用的一组通用候选 (用于嵌套)
  const commonGroupList = [
    '🚀 万金油',
    '🏡 家宽节点',
    '🚀 手动切换',
    '🇺🇲 美国节点',
    '🇭🇰 香港节点',
    '🇨🇳 台湾节点',
    '🇸🇬 新加坡节点',
    '🇯🇵 日本节点',
    '🇰🇷 韩国节点',
    '🌐 其他地区',
  ]

  const groups = [
    // --- 核心入口组 ---
    {
      name: '🚀 万金油',
      type: 'select',
      proxies: ['♻️ 自动优选', '🚀 手动切换', ...commonGroupList.slice(1)], // 去掉万金油自己防止循环
    },
    {
      name: '♻️ 自动优选',
      type: 'url-test',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      tolerance: 50,
      proxies: fallback(autoNodes),
    },
    {
      name: '🚀 手动切换',
      type: 'select',
      proxies: allProxies.length > 0 ? allProxies : ['DIRECT'],
    },

    // --- 地区/功能组 (底层) ---
    { name: '🏡 家宽节点', type: 'select', proxies: fallback(homeNodes) },
    { name: '🎮 游戏节点', type: 'select', proxies: fallback(gameNodes) },
    { name: '🇭🇰 香港节点', type: 'select', proxies: fallback(hkNodes) },
    { name: '🇯🇵 日本节点', type: 'select', proxies: fallback(jpNodes) },
    { name: '🇸🇬 新加坡节点', type: 'select', proxies: fallback(sgNodes) },
    { name: '🇺🇲 美国节点', type: 'select', proxies: fallback(usNodes) },
    { name: '🇨🇳 台湾节点', type: 'select', proxies: fallback(twNodes) },
    { name: '🇰🇷 韩国节点', type: 'select', proxies: fallback(krNodes) },
    { name: '🌐 其他地区', type: 'select', proxies: fallback(otherNodes) },

    // --- AI 特殊组 ---
    { name: '🇺🇲 美国AI节点', type: 'select', proxies: fallback(usAiNodes) },
    { name: '🇸🇬 新加坡AI节点', type: 'select', proxies: fallback(sgAiNodes) },
    { name: '🇰🇷 韩国AI节点', type: 'select', proxies: fallback(krAiNodes) },
    { name: '🇯🇵 日本AI节点', type: 'select', proxies: fallback(jpAiNodes) },
    { name: '🌐 其他AI节点', type: 'select', proxies: fallback(otherAiNodes) },

    // --- 业务策略组 (嵌套引用) ---
    {
      name: '🤖 AI平台',
      type: 'select',
      proxies: [
        '🇺🇲 美国AI节点',
        '🚀 万金油',
        '🏡 家宽节点',
        '🚀 手动切换',
        '🇸🇬 新加坡AI节点',
        '🇯🇵 日本AI节点',
        '🇰🇷 韩国AI节点',
        '🌐 其他AI节点',
      ],
    },
    {
      name: '📱 Talkatone',
      type: 'select',
      proxies: ['🚀 万金油', ...commonGroupList.slice(1)],
    },
    {
      name: '😏 虚拟卡服务',
      type: 'select',
      proxies: ['🇸🇬 新加坡节点', '🚀 万金油', ...commonGroupList.slice(1)],
    },
    {
      name: '㉆ 学校服务',
      type: 'select',
      proxies: ['🇺🇲 美国节点', '🚀 万金油', ...commonGroupList.slice(1)],
    },
    {
      name: '🍇 PT服务',
      type: 'select',
      proxies: ['🚀 万金油', ...commonGroupList.slice(1)],
    },
    {
      name: '📲 电报消息',
      type: 'select',
      proxies: [
        '🚀 万金油',
        '🚀 手动切换',
        '🇺🇲 美国节点',
        '🇭🇰 香港节点',
        '🇨🇳 台湾节点',
        '🇸🇬 新加坡节点',
        '🇯🇵 日本节点',
        '🇰🇷 韩国节点',
        '🌐 其他地区',
      ],
    },
    {
      name: '📢 谷歌FCM',
      type: 'select',
      proxies: [
        '🇺🇲 美国AI节点',
        '🚀 万金油',
        '🚀 手动切换',
        '🇺🇲 美国节点',
        '🇭🇰 香港节点',
        '🇨🇳 台湾节点',
        '🇸🇬 新加坡节点',
        '🇯🇵 日本节点',
        '🇰🇷 韩国节点',
        '🌐 其他地区',
      ],
    },
    {
      name: 'Ⓜ️ 微软Bing',
      type: 'select',
      proxies: ['🇺🇲 美国AI节点', '🚀 万金油', ...commonGroupList.slice(2)],
    },
    {
      name: 'Ⓜ️ 微软云盘',
      type: 'select',
      proxies: ['🚀 万金油', '🚀 手动切换', '🎯 全球直连', ...commonGroupList.slice(3)],
    },
    {
      name: 'Ⓜ️ 微软服务',
      type: 'select',
      proxies: ['🚀 万金油', '🚀 手动切换', '🎯 全球直连', ...commonGroupList.slice(3)],
    },
    {
      name: '🍎 苹果服务',
      type: 'select',
      proxies: ['🚀 万金油', '🚀 手动切换', '🎯 全球直连', ...commonGroupList.slice(3)],
    },
    {
      name: '📹 油管视频',
      type: 'select',
      proxies: ['♻️ 自动优选', '🚀 万金油', '🚀 手动切换'],
    },
    {
      name: '🎥 奈飞视频',
      type: 'select',
      proxies: [
        '🚀 万金油',
        '🚀 手动切换',
        '🇺🇲 美国节点',
        '🇭🇰 香港节点',
        '🇨🇳 台湾节点',
        '🇸🇬 新加坡节点',
        '🇯🇵 日本节点',
        '🇰🇷 韩国节点',
        '🌐 其他地区',
      ],
    },
    {
      name: '🌍 国外媒体',
      type: 'select',
      proxies: [
        '🚀 万金油',
        '♻️ 自动优选',
        '🚀 手动切换',
        '🇺🇲 美国节点',
        '🇭🇰 香港节点',
        '🇨🇳 台湾节点',
        '🇸🇬 新加坡节点',
        '🇯🇵 日本节点',
        '🇰🇷 韩国节点',
        '🌐 其他地区',
      ],
    },
    {
      name: '🌏 国内媒体',
      type: 'select',
      proxies: ['🎯 全球直连', '🚀 手动切换', '🇭🇰 香港节点', '🇨🇳 台湾节点', '🇸🇬 新加坡节点', '🇯🇵 日本节点'],
    },
    {
      name: '🎮 游戏平台',
      type: 'select',
      proxies: [
        '🎮 游戏节点',
        '♻️ 自动优选',
        '🚀 手动切换',
        '🏡 家宽节点',
        '🇺🇲 美国节点',
        '🇭🇰 香港节点',
        '🇨🇳 台湾节点',
        '🇸🇬 新加坡节点',
        '🇯🇵 日本节点',
        '🇰🇷 韩国节点',
        '🌐 其他地区',
        'DIRECT',
      ],
    },
    {
      name: '🎯 全球直连',
      type: 'select',
      proxies: ['DIRECT', '🚀 手动切换'],
    },
    {
      name: '🛑 广告拦截',
      type: 'select',
      proxies: ['REJECT', 'DIRECT'],
    },
    {
      name: '🍃 应用净化',
      type: 'select',
      proxies: ['REJECT', 'DIRECT'],
    },
    {
      name: '🐟 漏网之鱼',
      type: 'select',
      proxies: [
        'DIRECT',
        '🚀 万金油',
        '🚀 手动切换',
        '🇺🇲 美国节点',
        '🇭🇰 香港节点',
        '🇨🇳 台湾节点',
        '🇸🇬 新加坡节点',
        '🇯🇵 日本节点',
        '🇰🇷 韩国节点',
        '🌐 其他地区',
      ],
    },
  ]

  // ==========================================
  // 4. 定义规则集 (Rule Providers)
  // ==========================================

  const ruleProviders = {
    Direct: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/Direct.list',
      path: './ruleset/Direct.list',
      interval: 86400,
    },
    AI: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/AI.list',
      path: './ruleset/AI.list',
      interval: 86400,
    },
    Talkatone: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/Talkatone.list',
      path: './ruleset/Talkatone.list',
      interval: 86400,
    },
    Card: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/Card.list',
      path: './ruleset/Card.list',
      interval: 86400,
    },
    School: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/School.list',
      path: './ruleset/School.list',
      interval: 86400,
    },
    PT: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/PT.list',
      path: './ruleset/PT.list',
      interval: 86400,
    },
    Proxy: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/WanderingSoul49/myproxy/refs/heads/main/ruleset/list/Proxy.list',
      path: './ruleset/Proxy.list',
      interval: 86400,
    },

    // ACL4SSR Lists
    LocalAreaNetwork: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list',
      path: './ruleset/LocalAreaNetwork.list',
      interval: 86400,
    },
    UnBan: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/UnBan.list',
      path: './ruleset/UnBan.list',
      interval: 86400,
    },
    BanAD: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list',
      path: './ruleset/BanAD.list',
      interval: 86400,
    },
    BanProgramAD: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list',
      path: './ruleset/BanProgramAD.list',
      interval: 86400,
    },
    GoogleFCM: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list',
      path: './ruleset/GoogleFCM.list',
      interval: 86400,
    },
    GoogleCN: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list',
      path: './ruleset/GoogleCN.list',
      interval: 86400,
    },
    SteamCN: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list',
      path: './ruleset/SteamCN.list',
      interval: 86400,
    },
    AI_ACL: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/AI.list',
      path: './ruleset/AI_ACL.list',
      interval: 86400,
    },
    OpenAi_ACL: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list',
      path: './ruleset/OpenAi_ACL.list',
      interval: 86400,
    },
    Bing: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Bing.list',
      path: './ruleset/Bing.list',
      interval: 86400,
    },
    OneDrive: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/OneDrive.list',
      path: './ruleset/OneDrive.list',
      interval: 86400,
    },
    Microsoft: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list',
      path: './ruleset/Microsoft.list',
      interval: 86400,
    },
    Apple: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Apple.list',
      path: './ruleset/Apple.list',
      interval: 86400,
    },
    Telegram: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list',
      path: './ruleset/Telegram.list',
      interval: 86400,
    },
    YouTube: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list',
      path: './ruleset/YouTube.list',
      interval: 86400,
    },
    Netflix: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list',
      path: './ruleset/Netflix.list',
      interval: 86400,
    },
    ChinaMedia: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaMedia.list',
      path: './ruleset/ChinaMedia.list',
      interval: 86400,
    },
    ProxyMedia: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list',
      path: './ruleset/ProxyMedia.list',
      interval: 86400,
    },
    Epic: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Epic.list',
      path: './ruleset/Epic.list',
      interval: 86400,
    },
    Origin: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Origin.list',
      path: './ruleset/Origin.list',
      interval: 86400,
    },
    Sony: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Sony.list',
      path: './ruleset/Sony.list',
      interval: 86400,
    },
    Steam: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Steam.list',
      path: './ruleset/Steam.list',
      interval: 86400,
    },
    Nintendo: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Nintendo.list',
      path: './ruleset/Nintendo.list',
      interval: 86400,
    },
    ProxyGFWlist: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyGFWlist.list',
      path: './ruleset/ProxyGFWlist.list',
      interval: 86400,
    },
    ChinaDomain: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list',
      path: './ruleset/ChinaDomain.list',
      interval: 86400,
    },
    ChinaCompanyIp: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list',
      path: './ruleset/ChinaCompanyIp.list',
      interval: 86400,
    },
    Download: {
      type: 'http',
      behavior: 'classical',
      url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Download.list',
      path: './ruleset/Download.list',
      interval: 86400,
    },

    // [已注释 - 保留条目] 哔哩哔哩
    // "BilibiliHMT": { type: "http", behavior: "classical", url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/BilibiliHMT.list", path: "./ruleset/BilibiliHMT.list", interval: 86400 },
    // "Bilibili": { type: "http", behavior: "classical", url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Bilibili.list", path: "./ruleset/Bilibili.list", interval: 86400 },
  }

  // ==========================================
  // 5. 组装规则 (Rules)
  // ==========================================

  const rules = [
    'RULE-SET,Direct,🎯 全球直连',
    'RULE-SET,AI,🤖 AI平台',
    'RULE-SET,Talkatone,📱 Talkatone',
    'RULE-SET,Card,😏 虚拟卡服务',
    'RULE-SET,School,㉆ 学校服务',
    'RULE-SET,PT,🍇 PT服务',
    'RULE-SET,Proxy,🚀 万金油',
    'RULE-SET,LocalAreaNetwork,🎯 全球直连',
    'RULE-SET,UnBan,🎯 全球直连',
    'RULE-SET,BanAD,🛑 广告拦截',
    'RULE-SET,BanProgramAD,🍃 应用净化',
    'RULE-SET,GoogleFCM,📢 谷歌FCM',
    'RULE-SET,GoogleCN,🎯 全球直连',
    'RULE-SET,SteamCN,🎯 全球直连',
    'RULE-SET,AI_ACL,🤖 AI平台',
    'RULE-SET,OpenAi_ACL,🤖 AI平台',
    'RULE-SET,Bing,Ⓜ️ 微软Bing',
    'RULE-SET,OneDrive,Ⓜ️ 微软云盘',
    'RULE-SET,Microsoft,Ⓜ️ 微软服务',
    'RULE-SET,Apple,🍎 苹果服务',
    'RULE-SET,Telegram,📲 电报消息',
    'RULE-SET,YouTube,📹 油管视频',
    'RULE-SET,Netflix,🎥 奈飞视频',

    // [已注释] 哔哩哔哩规则
    // "RULE-SET,BilibiliHMT,📺 哔哩哔哩",
    // "RULE-SET,Bilibili,📺 哔哩哔哩",

    'RULE-SET,ChinaMedia,🌏 国内媒体',
    'RULE-SET,ProxyMedia,🌍 国外媒体',
    'RULE-SET,Epic,🎮 游戏平台',
    'RULE-SET,Origin,🎮 游戏平台',
    'RULE-SET,Sony,🎮 游戏平台',
    'RULE-SET,Steam,🎮 游戏平台',
    'RULE-SET,Nintendo,🎮 游戏平台',
    'RULE-SET,ProxyGFWlist,🚀 万金油',
    'RULE-SET,ChinaDomain,🎯 全球直连',
    'RULE-SET,ChinaCompanyIp,🎯 全球直连',
    'RULE-SET,Download,🎯 全球直连',

    // GeoSite 规则
    'GEOSITE,CN,🎯 全球直连',
    'GEOSITE,geolocation-!cn,🚀 万金油',

    // [已注释 - 保留条目] 非必要不加 no-resolve
    // "GEOIP,CN,🎯 全球直连,no-resolve",

    'GEOIP,CN,🎯 全球直连',

    // Final 漏网之鱼
    'MATCH,🐟 漏网之鱼',
  ]

  // ==========================================
  // 6. 应用覆盖
  // ==========================================

  // 覆盖策略组
  config['proxy-groups'] = groups

  // 覆盖规则集
  config['rule-providers'] = ruleProviders

  // 覆盖规则
  config['rules'] = rules

  // 强制开启 ipv6 (可选，根据原配置习惯调整)
  // config['ipv6'] = true

  return config
}
