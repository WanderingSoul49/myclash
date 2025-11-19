/**
 * 多模型 AI 深度检测脚本 (Sub-Store Node.js Pro)
 *
 * 🚀 核心逻辑
 * 本脚本通过 HTTP META 服务，对代理节点进行多维度的 AI 服务可用性检测。
 * 相比传统脚本，它支持基于内容的深度检测（如解决 Gemini 200 状态码假阳性问题）。
 *
 * ⚙️ 核心参数配置 (Arguments)
 *
 * 1. [test_targets] 检测目标集合 (核心参数)
 *    - 描述: 指定需要检测的平台，多个目标用逗号分隔。
 *    - 可选值: gpt, claude, gemini, custom
 *    - 逻辑: 只有当列表中的 *所有* 目标都检测通过时，节点才会被标记为可用。
 *    - 默认值: "gpt,claude,gemini"
 *    - 示例: "gemini,claude" (只检测 Gemini 和 Claude，且必须同时可用)
 *
 * 2. [test_urls] 自定义测试地址
 *    - 描述: 仅当 test_targets 包含 "custom" 时生效。
 *    - 格式: 逗号分隔的 URL 字符串，支持带方括号格式。
 *    - 示例: "https://www.google.com,https://bing.com" 或 "[https://demo.com]"
 *
 * 3. [http_meta_*] HTTP META 服务配置
 *    - http_meta_host: 服务地址 (默认 127.0.0.1)
 *    - http_meta_port: 端口 (默认 9876)
 *    - http_meta_start_delay: 启动等待时间 (默认 3000ms)
 *
 * 4. [ai_prefix] 结果标记
 *    - 描述: 检测通过后，在节点名称前添加的前缀。
 *    - 默认: "[AI] "
 *
 * 5. [timeout] & [concurrency]
 *    - timeout: 单个请求超时 (默认 8000ms)
 *    - concurrency: 并发检测的节点数量 (默认 10)
 *
 * 🧠 智能检测规则详解
 *
 * | 目标 (Target) | 检测 URL | 判定通过规则 (Pass Criteria) | 特殊处理 (Edge Cases) |
 * |--------------|---------|----------------------------|----------------------|
 * | gpt          | chat.openai.com | 状态码 200-399 或 403 | 排除 body 含 "unsupported_country" |
 * | claude       | claude.ai | 状态码 200-399 或 403 | 排除 body 含 "blocked", "banned" |
 * | gemini       | gemini.google.com | 状态码 200-399 | 排除 body 含 "not supported", "unavailable" |
 * | custom       | 用户自定义 | 状态码 200-399 | 通用状态码检测 |
 *
 * ⚡ 使用场景示例
 * -------------------------------------------------
 * 场景 A: 我只想筛选出能用 Gemini 的节点
 * [test_targets] gemini
 *
 * 场景 B: 我需要节点既能用 GPT 也能用 Claude
 * [test_targets] gpt,claude
 *
 * 场景 C: 检测 Gemini 和一个私有 API
 * [test_targets] gemini,custom
 * [test_urls] https://api.private.com/check
 * -------------------------------------------------
 */

async function operator(proxies = [], targetPlatform, context) {
  // ---------------- 配置初始化 ----------------
  const $ = $substore
  const cache = scriptResourceCache

  // 基础参数
  const cacheEnabled = $arguments.cache === 'true'
  const disableFailedCache = $arguments.disable_failed_cache === 'true' || $arguments.ignore_failed_error === 'true'
  const aiPrefix = $arguments.ai_prefix ?? '[AI] '

  // HTTP META 参数
  const http_meta_host = $arguments.http_meta_host ?? '127.0.0.1'
  const http_meta_port = $arguments.http_meta_port ?? 9876
  const http_meta_protocol = $arguments.http_meta_protocol ?? 'http'
  const http_meta_authorization = $arguments.http_meta_authorization ?? ''
  const http_meta_api = `${http_meta_protocol}://${http_meta_host}:${http_meta_port}`
  const http_meta_start_delay = parseFloat($arguments.http_meta_start_delay ?? 3000)
  const http_meta_proxy_timeout = parseFloat($arguments.http_meta_proxy_timeout ?? 15000)

  // 🎯 目标解析逻辑
  const rawTargets = $arguments.test_targets ?? 'gpt,claude,gemini'
  const targetList = rawTargets
    .toLowerCase()
    .split(/[,，\s]+/)
    .filter(Boolean)

  // 构建待测试的 URL 列表对象
  // 结构: [{ id: 'gpt', url: '...', name: 'ChatGPT' }, ...]
  const checkQueue = []

  // 1. OpenAI (GPT)
  if (targetList.includes('gpt')) {
    const client = $arguments.client === 'Android' ? 'android' : 'ios'
    checkQueue.push({
      id: 'gpt',
      name: 'ChatGPT',
      url: `https://${client}.chat.openai.com`,
      type: 'gpt',
    })
  }

  // 2. Claude
  if (targetList.includes('claude')) {
    checkQueue.push({
      id: 'claude',
      name: 'Claude',
      url: 'https://claude.ai',
      type: 'claude',
    })
  }

  // 3. Gemini
  if (targetList.includes('gemini')) {
    checkQueue.push({
      id: 'gemini',
      name: 'Gemini',
      url: 'https://gemini.google.com',
      type: 'gemini',
    })
  }

  // 4. Custom (自定义)
  if (targetList.includes('custom')) {
    const rawUrls = $arguments.test_urls ?? ''
    // 移除可能存在的方括号并分割
    const customUrls = rawUrls
      .replace(/^\[|\]$/g, '')
      .split(/[,，\s]+/)
      .filter(Boolean)

    customUrls.forEach((url, idx) => {
      let hostname = 'Custom'
      try {
        hostname = new URL(url).hostname
      } catch (e) {}
      checkQueue.push({
        id: `custom_${idx}`,
        name: hostname,
        url: url,
        type: 'custom',
      })
    })
  }

  if (checkQueue.length === 0) {
    $.error('⚠️ 未配置有效的检测目标 (test_targets)，请检查参数')
    return proxies
  }

  // ---------------- 代理预处理 ----------------
  const internalProxies = []
  proxies.forEach((proxy, index) => {
    try {
      // 转换为 ClashMeta 格式以便内核识别
      const node = ProxyUtils.produce([{ ...proxy }], 'ClashMeta', 'internal')?.[0]
      if (node) {
        // 保留原始节点的自定义字段 (如 _latency 等)
        for (const key in proxy) {
          if (/^_/i.test(key)) node[key] = proxy[key]
        }
        internalProxies.push({ ...node, _proxies_index: index })
      }
    } catch (e) {
      $.error(`代理转换失败: ${e.message}`)
    }
  })

  $.info(`\n🔍 检测目标: ${targetList.join(', ')}`)
  $.info(`🔗 测试 URL 数: ${checkQueue.length}`)
  $.info(`🚀 待测节点数: ${internalProxies.length}/${proxies.length}`)

  if (!internalProxies.length) return proxies

  // ---------------- 缓存预检 ----------------
  if (cacheEnabled) {
    let allCached = true
    // 生成基于目标组合的唯一指纹
    const targetFingerprint = checkQueue.map(i => i.url).join('|')

    for (const proxy of internalProxies) {
      const cacheKey = getCacheId(proxy, targetFingerprint)
      const cached = cache.get(cacheKey)

      if (cached) {
        const originalProxy = proxies[proxy._proxies_index]
        if (cached.ai_available) {
          applyAiTag(originalProxy, cached.ai_results, cached.ai_latency)
        } else if (disableFailedCache) {
          // 如果禁用了失败缓存，且当前是失败记录，则需要重新测
          allCached = false
          break
        }
        // 如果是失败缓存且允许使用，则保持原样(不加tag)
      } else {
        allCached = false
        break
      }
    }
    if (allCached) {
      $.info('✅ 所有节点均命中缓存，跳过检测')
      return proxies
    }
  }

  // ---------------- 启动 HTTP META ----------------
  // 计算总超时: 启动延时 + (节点数 * 单节点超时)
  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout
  let http_meta_pid
  let http_meta_ports = []

  try {
    const startRes = await http({
      method: 'post',
      url: `${http_meta_api}/start`,
      headers: { 'Content-type': 'application/json', Authorization: http_meta_authorization },
      body: JSON.stringify({ proxies: internalProxies, timeout: http_meta_timeout }),
      timeout: 5000,
    })

    const body = JSON.parse(startRes.body || '{}')
    if (!body.pid || !body.ports) throw new Error(`启动响应异常: ${startRes.body}`)

    http_meta_pid = body.pid
    http_meta_ports = body.ports

    $.info(`✅ HTTP META 启动成功 (PID: ${http_meta_pid})`)
    $.info(`⏳ 等待 ${http_meta_start_delay}ms 让核心就绪...`)
    await $.wait(http_meta_start_delay)
  } catch (e) {
    $.error(`❌ HTTP META 启动失败: ${e.message}`)
    return proxies
  }

  // ---------------- 执行并发检测 ----------------
  const concurrency = parseInt($arguments.concurrency || 10)

  await executeAsyncTasks(
    internalProxies.map((proxy, idx) => () => checkNode(proxy, http_meta_ports[idx])),
    { concurrency }
  )

  // ---------------- 关闭 HTTP META ----------------
  try {
    await http({
      method: 'post',
      url: `${http_meta_api}/stop`,
      headers: { 'Content-type': 'application/json', Authorization: http_meta_authorization },
      body: JSON.stringify({ pid: [http_meta_pid] }),
    })
    $.info('🛑 HTTP META 已关闭')
  } catch (e) {
    $.error(`关闭核心失败: ${e.message}`)
  }

  return proxies

  // ==================================================
  // 🧩 核心功能函数
  // ==================================================

  /**
   * 单个节点检测逻辑
   */
  async function checkNode(proxy, port) {
    const targetFingerprint = checkQueue.map(i => i.url).join('|')
    const cacheKey = getCacheId(proxy, targetFingerprint)
    const originalProxy = proxies[proxy._proxies_index]

    // 1. 再次检查缓存 (防止并发导致的重复)
    if (cacheEnabled) {
      const cached = cache.get(cacheKey)
      if (cached) {
        if (cached.ai_available) {
          applyAiTag(originalProxy, cached.ai_results, cached.ai_latency)
          $.info(`[${proxy.name}] 🎯 命中缓存: 可用`)
        } else if (!disableFailedCache) {
          $.info(`[${proxy.name}] 🎯 命中缓存: 不可用`)
        } else {
          // 缓存了失败但配置为忽略失败缓存 -> 继续检测
        }
        if (cached.ai_available || !disableFailedCache) return
      }
    }

    const results = {}
    let totalLatency = 0
    let passedCount = 0

    // 2. 遍历所有目标进行检测
    // 注意：此处串行检测单个节点的不同URL，避免单节点并发过大被风控
    for (const target of checkQueue) {
      const result = await testUrl(target, port)
      results[target.id] = result
      if (result.passed) {
        passedCount++
        totalLatency += result.latency
      } else {
        // ⚠️ 优化：如果在严格模式下，只要有一个失败，其实就可以提前结束
        // 但为了展示完整结果，这里继续运行，或者您可以选择 break
        // break
      }
    }

    // 3. 判定结果
    // 逻辑：必须所有 test_targets 指定的目标都通过
    const isAvailable = passedCount === checkQueue.length
    const avgLatency = isAvailable ? Math.round(totalLatency / checkQueue.length) : 0

    // 4. 应用结果与缓存
    if (isAvailable) {
      applyAiTag(originalProxy, results, avgLatency)
      $.info(`[${proxy.name}] ✅ 通过 (${passedCount}/${checkQueue.length}) ${avgLatency}ms`)
    } else {
      originalProxy._ai_available = false
      originalProxy._ai_results = results
      $.info(`[${proxy.name}] ❌ 失败 (${passedCount}/${checkQueue.length})`)
    }

    if (cacheEnabled) {
      cache.set(cacheKey, {
        ai_available: isAvailable,
        ai_results: results,
        ai_latency: avgLatency,
      })
    }
  }

  /**
   * 单个 URL 测试逻辑
   */
  async function testUrl(target, port) {
    const start = Date.now()
    try {
      const res = await http({
        proxy: `http://${http_meta_host}:${port}`,
        method: 'GET',
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        url: target.url,
        timeout: parseFloat($arguments.timeout || 8000),
      })

      const latency = Date.now() - start
      const status = res.status || res.statusCode || 0

      let body = res.body || res.rawBody || ''
      if (typeof body !== 'string') body = JSON.stringify(body)

      // 🕵️‍♀️ 深度判定逻辑
      let passed = false
      let msg = 'OK'

      if (target.type === 'gemini') {
        // 💎 Gemini 专用检测
        // 失败特征：状态码可能为 200，但内容包含不支持信息
        const failRegex =
          /not supported in your country|目前不支持你所在的地区|unavailable in your country|could not sign in/i
        if (failRegex.test(body)) {
          passed = false
          msg = 'Region Unsupported (Content Check)'
        } else if ([200, 301, 302, 307, 308].includes(status)) {
          passed = true
        } else if (status === 403 || status === 429) {
          passed = false
          msg = `Blocked (${status})`
        } else {
          passed = status >= 200 && status < 400
        }
      } else if (target.type === 'gpt') {
        // 🤖 GPT 专用检测
        if (/unsupported_country/i.test(body)) {
          passed = false
          msg = 'Region Unsupported'
        } else {
          // 403 通常是 Cloudflare 盾，对于节点检测来说，能连上盾通常意味着 IP 未被完全拉黑(或者需要过盾)，
          // 但严格来说，如果无法通过盾，API也无法使用。
          // 宽松模式下 403 算通过，严格模式下建议算失败。此处沿用宽松逻辑。
          passed = [200, 301, 302, 307, 308, 403].includes(status)
        }
      } else if (target.type === 'claude') {
        // 🎭 Claude 专用检测
        if (/blocked|banned/i.test(body) || body.includes('App unavailable')) {
          passed = false
          msg = 'Blocked/Banned'
        } else {
          passed = [200, 301, 302, 307, 308, 403].includes(status)
        }
      } else {
        // 🌐 通用检测
        passed = status >= 200 && status < 400
      }

      return { passed, latency, status, msg }
    } catch (e) {
      return { passed: false, latency: -1, status: 0, msg: e.message }
    }
  }

  /**
   * 辅助函数：应用 AI 标记
   */
  function applyAiTag(proxyNode, results, latency) {
    // 避免重复添加前缀
    if (!proxyNode.name.startsWith(aiPrefix)) {
      proxyNode.name = `${aiPrefix}${proxyNode.name}`
    }
    proxyNode._ai_available = true
    proxyNode._ai_results = results
    proxyNode._ai_latency = latency
  }

  /**
   * 辅助函数：生成缓存 ID
   */
  function getCacheId(proxy, fingerprint) {
    // 过滤掉易变字段，只保留核心配置作为 Key
    const safeProxy = {}
    for (const k in proxy) {
      if (!/^(name|collectionName|subName|id|_.*)$/i.test(k)) {
        safeProxy[k] = proxy[k]
      }
    }
    return `http-meta:ai-check:${fingerprint}:${JSON.stringify(safeProxy)}`
  }

  /**
   * 辅助函数：随机 UA
   */
  function getRandomUserAgent() {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  /**
   * 基础 HTTP 封装
   */
  async function http(opt = {}) {
    const RETRIES = 1
    const DELAY = 1000
    for (let i = 0; i <= RETRIES; i++) {
      try {
        return await $.http[opt.method](opt)
      } catch (e) {
        if (i === RETRIES) throw e
        await $.wait(DELAY)
      }
    }
  }

  /**
   * 并发执行器
   */
  function executeAsyncTasks(tasks, { concurrency = 5 } = {}) {
    return new Promise(resolve => {
      let completed = 0
      let running = 0
      let index = 0

      const next = () => {
        if (index >= tasks.length) {
          if (running === 0) resolve()
          return
        }

        running++
        const task = tasks[index++]
        task().finally(() => {
          running--
          completed++
          next()
        })
      }

      for (let i = 0; i < concurrency; i++) next()
    })
  }
}
