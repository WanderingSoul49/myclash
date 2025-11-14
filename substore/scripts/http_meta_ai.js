/**
 * 多模型 AI 检测脚本 (Sub-Store Node.js 版)
 *
 * 🎯 核心功能
 * 通过 HTTP META 服务对代理节点进行多平台 AI 可用性检测
 * 支持同时检测多个 AI 平台(GPT/Claude/Gemini)，可配置"全部通过"或"部分通过"模式
 *
 * 🎈 HTTP META 参数
 * 文档: https://github.com/xream/http-meta
 * - [http_meta_protocol] 协议 默认: http
 * - [http_meta_host] 服务地址 默认: 127.0.0.1
 * - [http_meta_port] 端口号 默认: 9876
 * - [http_meta_authorization] 授权令牌 默认: (空)
 * - [http_meta_start_delay] 初始启动延时(单位: 毫秒) 默认: 3000
 * - [http_meta_proxy_timeout] 每个节点检测超时(单位: 毫秒) 默认: 15000
 *   ⚠️ 注: 总超时 = 初始延时 + (节点数 × 单个节点超时) 用于防止脚本异常退出未关闭核心
 *
 * ⚙️ 检测配置参数
 * - [timeout] 单个请求超时(单位: 毫秒) 默认: 8000
 * - [retries] 失败重试次数 默认: 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认: 1000
 * - [concurrency] 节点检测并发数 默认: 10
 * - [method] HTTP 请求方式 默认: get
 * - [client] OpenAI 客户端类型 默认: iOS
 *
 * 🤖 AI 检测专用参数
 * - [require_all_pass] 是否要求所有平台检测通过才标记为可用 默认: true
 *   - true: 所有平台都通过才标记为可用(AI 图标)
 *   - false: 任一平台通过即标记为可用(AI 图标)
 * - [test_openai] 是否检测 OpenAI 平台 默认: true
 * - [test_claude] 是否检测 Claude 平台 默认: true
 * - [test_gemini] 是否检测 Gemini 平台 默认: true
 * - [test_urls] 自定义测试地址(逗号分隔)，优先级高于上述 test_* 参数
 *   示例: "https://claude.ai,https://gemini.google.com"
 *
 * 🏷️ 结果标记参数
 * - [ai_prefix] AI 可用节点名称前缀 默认: "[AI] "
 * - [cache] 启用缓存机制 默认: false
 * - [disable_failed_cache/ignore_failed_error] 禁用失败结果缓存 默认: (未启用)
 *
 * 📊 检测结果字段(添加到节点)
 * - `_ai_available` 布尔值, true: AI 可用, false: AI 不可用
 * - `_ai_latency` 平均响应延迟(毫秒)
 * - `_ai_pass_count` 通过检测的平台数量
 * - `_ai_results` 各平台详细检测结果对象
 *
 * 📝 AI 平台检测规则(优化版)
 * | 平台 | 检测地址 | 成功状态码 | 失败条件 |
 * |------|---------|----------|---------|
 * | OpenAI(GPT) | ios/android.chat.openai.com | 200/301/302/307/308/403 | unsupported_country 错误 |
 * | Claude | claude.ai | 200/301/302/307/308/403 | blocked/banned 消息 |
 * | Gemini | gemini.google.com/aistudio.google.com | 200/301/302/307/308 | 403/429 限制访问 |
 *
 * 💾 缓存机制
 * - 缓存时长由 sub-store-csr-expiration-time 控制(默认: 172800000ms = 48小时)
 * - Loon 可在插件中设置此值
 * - 可通过 disable_failed_cache 参数设置不缓存失败结果
 *
 * ⚡ 使用示例
 * ```
 * // 基础用法: 检测所有平台,要求全部通过
 * // 自定义用法: 只检测 Claude 和 Gemini,任一通过即可
 * [test_openai] false
 * [require_all_pass] false
 * ```
 *
 * 🔄 使用场景
 * - Outbound 筛选: 只保留 AI 可用节点
 * - 节点重命名: 在节点名加上 [AI] 前缀
 * - 质量评估: 通过延迟和通过率评估节点质量
 */

async function operator(proxies = [], targetPlatform, context) {
  const cacheEnabled = $arguments.cache
  const disableFailedCache = $arguments.disable_failed_cache || $arguments.ignore_failed_error
  const cache = scriptResourceCache
  const http_meta_host = $arguments.http_meta_host ?? '127.0.0.1'
  const http_meta_port = $arguments.http_meta_port ?? 9876
  const http_meta_protocol = $arguments.http_meta_protocol ?? 'http'
  const http_meta_authorization = $arguments.http_meta_authorization ?? ''
  const http_meta_api = `${http_meta_protocol}://${http_meta_host}:${http_meta_port}`
  const http_meta_start_delay = parseFloat($arguments.http_meta_start_delay ?? 3000)
  const http_meta_proxy_timeout = parseFloat($arguments.http_meta_proxy_timeout ?? 15000) // 增加超时时间

  // 新增配置参数
  const aiPrefix = $arguments.ai_prefix ?? '[AI] '
  const requireAllPass = $arguments.require_all_pass !== 'false'
  const testOpenAI = $arguments.test_openai !== 'false'
  const testClaude = $arguments.test_claude !== 'false'
  const testGemini = $arguments.test_gemini !== 'false'

  // 构建测试URL列表
  const defaultUrls = []
  if (testOpenAI) {
    const openaiUrl =
      $arguments.client === 'Android' ? 'https://android.chat.openai.com' : 'https://ios.chat.openai.com'
    defaultUrls.push(openaiUrl)
  }
  if (testClaude) {
    defaultUrls.push('https://claude.ai')
  }
  if (testGemini) {
    defaultUrls.push('https://gemini.google.com')
    defaultUrls.push('https://aistudio.google.com')
  }

  const testUrls = $arguments.test_urls ? $arguments.test_urls.split(',').map(url => url.trim()) : defaultUrls

  const method = $arguments.method || 'get'

  const $ = $substore
  const internalProxies = []

  // 处理代理节点
  proxies.map((proxy, index) => {
    try {
      const node = ProxyUtils.produce([{ ...proxy }], 'ClashMeta', 'internal')?.[0]
      if (node) {
        for (const key in proxy) {
          if (/^_/i.test(key)) {
            node[key] = proxy[key]
          }
        }
        internalProxies.push({ ...node, _proxies_index: index })
      }
    } catch (e) {
      $.error(e)
    }
  })

  $.info(`核心支持节点数: ${internalProxies.length}/${proxies.length}`)
  $.info(`测试地址: ${testUrls.join(', ')}`)
  $.info(`要求全部通过: ${requireAllPass}`)

  if (!internalProxies.length) return proxies

  // 缓存检查
  if (cacheEnabled) {
    try {
      let allCached = true
      for (var i = 0; i < internalProxies.length; i++) {
        const proxy = internalProxies[i]
        const id = getCacheId({ proxy, urls: testUrls })
        const cached = cache.get(id)
        if (cached) {
          if (cached.ai_available) {
            proxies[proxy._proxies_index].name = `${aiPrefix}${proxies[proxy._proxies_index].name}`
            proxies[proxy._proxies_index]._ai_available = true
            proxies[proxy._proxies_index]._ai_results = cached.ai_results
            proxies[proxy._proxies_index]._ai_latency = cached.ai_latency
          } else if (disableFailedCache) {
            allCached = false
            break
          }
        } else {
          allCached = false
          break
        }
      }
      if (allCached) {
        $.info('所有节点都有有效缓存 完成')
        return proxies
      }
    } catch (e) {}
  }

  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout

  let http_meta_pid
  let http_meta_ports = []

  // 启动 HTTP META
  const res = await http({
    retries: 0,
    method: 'post',
    url: `${http_meta_api}/start`,
    headers: {
      'Content-type': 'application/json',
      Authorization: http_meta_authorization,
    },
    body: JSON.stringify({
      proxies: internalProxies,
      timeout: http_meta_timeout,
    }),
  })

  let body = res.body
  try {
    body = JSON.parse(body)
  } catch (e) {}

  const { ports, pid } = body
  if (!pid || !ports) {
    throw new Error(`======== HTTP META 启动失败 ====\n${body}`)
  }

  http_meta_pid = pid
  http_meta_ports = ports

  $.info(
    `\n======== HTTP META 启动 ====\n[端口] ${ports}\n[PID] ${pid}\n[超时] 若未手动关闭 ${
      Math.round(http_meta_timeout / 60 / 10) / 100
    } 分钟后自动关闭\n`
  )
  $.info(`等待 ${http_meta_start_delay / 1000} 秒后开始检测`)
  await $.wait(http_meta_start_delay)

  const concurrency = parseInt($arguments.concurrency || 10) // 降低并发数，因为要测试多个地址
  await executeAsyncTasks(
    internalProxies.map(proxy => () => checkMultipleUrls(proxy)),
    { concurrency }
  )

  // 关闭 HTTP META
  try {
    const res = await http({
      method: 'post',
      url: `${http_meta_api}/stop`,
      headers: {
        'Content-type': 'application/json',
        Authorization: http_meta_authorization,
      },
      body: JSON.stringify({
        pid: [http_meta_pid],
      }),
    })
    $.info(`\n======== HTTP META 关闭 ====\n${JSON.stringify(res, null, 2)}`)
  } catch (e) {
    $.error(`关闭 HTTP META 失败: ${e.message ?? e}`)
  }

  return proxies

  // 检测多个URL的函数
  async function checkMultipleUrls(proxy) {
    const id = cacheEnabled ? getCacheId({ proxy, urls: testUrls }) : undefined

    try {
      const cached = cache.get(id)
      if (cacheEnabled && cached) {
        if (cached.ai_available) {
          proxies[proxy._proxies_index].name = `${aiPrefix}${proxies[proxy._proxies_index].name}`
          proxies[proxy._proxies_index]._ai_available = true
          proxies[proxy._proxies_index]._ai_results = cached.ai_results
          proxies[proxy._proxies_index]._ai_latency = cached.ai_latency
          $.info(`[${proxy.name}] 使用成功缓存`)
          return
        } else if (disableFailedCache) {
          $.info(`[${proxy.name}] 不使用失败缓存`)
        } else {
          $.info(`[${proxy.name}] 使用失败缓存`)
          return
        }
      }

      const index = internalProxies.indexOf(proxy)
      const results = {}
      let totalLatency = 0
      let passedCount = 0

      // 并发检测所有URL
      const urlChecks = testUrls.map(async url => {
        const startedAt = Date.now()
        try {
          const res = await http({
            proxy: `http://${http_meta_host}:${http_meta_ports[index]}`,
            method,
            headers: {
              'User-Agent': getRandomUserAgent(),
            },
            url,
            timeout: 10000, // 单个URL检测超时
          })

          const status = parseInt(res.status || res.statusCode || 200)
          const latency = Date.now() - startedAt
          totalLatency += latency

          let body = String(res.body ?? res.rawBody)
          try {
            body = JSON.parse(body)
          } catch (e) {}

          const msg = body?.error?.code || body?.error?.error_type || body?.cf_details
          const passed = checkUrlSuccess(url, status, msg, body)

          results[url] = {
            status,
            latency,
            passed,
            msg: msg || 'OK',
          }

          if (passed) passedCount++

          $.info(`[${proxy.name}] ${getUrlName(url)}: ${status}, ${passed ? '✅' : '❌'}, ${latency}ms`)
        } catch (e) {
          results[url] = {
            status: 'ERROR',
            latency: Date.now() - startedAt,
            passed: false,
            msg: e.message || e.toString(),
          }
          $.error(`[${proxy.name}] ${getUrlName(url)}: ${e.message || e}`)
        }
      })

      await Promise.all(urlChecks)

      const avgLatency = Math.round(totalLatency / testUrls.length)
      const allPassed = passedCount === testUrls.length
      const available = requireAllPass ? allPassed : passedCount > 0

      $.info(
        `[${proxy.name}] 结果: ${passedCount}/${testUrls.length} 通过, 平均延迟: ${avgLatency}ms, 可用: ${
          available ? '✅' : '❌'
        }`
      )

      if (available) {
        proxies[proxy._proxies_index].name = `${aiPrefix}${proxies[proxy._proxies_index].name}`
        proxies[proxy._proxies_index]._ai_available = true
        proxies[proxy._proxies_index]._ai_results = results
        proxies[proxy._proxies_index]._ai_latency = avgLatency
        proxies[proxy._proxies_index]._ai_pass_count = passedCount

        if (cacheEnabled) {
          cache.set(id, {
            ai_available: true,
            ai_results: results,
            ai_latency: avgLatency,
            ai_pass_count: passedCount,
          })
        }
      } else {
        proxies[proxy._proxies_index]._ai_available = false
        proxies[proxy._proxies_index]._ai_results = results
        proxies[proxy._proxies_index]._ai_pass_count = passedCount

        if (cacheEnabled) {
          cache.set(id, {
            ai_available: false,
            ai_results: results,
            ai_pass_count: passedCount,
          })
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] 整体检测失败: ${e.message ?? e}`)
      if (cacheEnabled) {
        cache.set(id, { ai_available: false })
      }
    }
  }

  // 判断URL检测是否成功
  function checkUrlSuccess(url, status, msg, body) {
    if (url.includes('chat.openai.com')) {
      // OpenAI/ChatGPT 检测优化:
      // ✅ 200/301/302/307/308: 正常访问/重定向
      // ✅ 403: 可访问但需登录(只要不是 unsupported_country 错误)
      // ❌ unsupported_country: 地区不支持
      if (/unsupported_country/.test(msg)) {
        return false
      }
      return [200, 301, 302, 307, 308, 403].includes(status)
    } else if (url.includes('claude.ai')) {
      // Claude 检测优化:
      // ✅ 200/301/302/307/308: 正常访问/重定向
      // ✅ 403: 可访问但可能需要验证(检查是否被明确阻止)
      // ❌ blocked/banned: 被阻止
      if (msg && (msg.includes('blocked') || msg.includes('banned'))) {
        return false
      }
      return [200, 301, 302, 307, 308, 403].includes(status)
    } else if (url.includes('gemini.google.com') || url.includes('aistudio.google.com')) {
      // Gemini 检测优化:
      // ✅ 200: 正常访问
      // ✅ 301/302/307/308: 重定向(Google 常见行为)
      // ❌ 403/429: 被限制访问
      return [200, 301, 302, 307, 308].includes(status)
    } else {
      // 通用判断：200-399 状态码认为成功
      return status >= 200 && status < 400
    }
  }

  // 获取URL显示名称
  function getUrlName(url) {
    if (url.includes('chat.openai.com')) return 'ChatGPT'
    if (url.includes('claude.ai')) return 'Claude'
    if (url.includes('gemini.google.com')) return 'Gemini'
    if (url.includes('aistudio.google.com')) return 'AI Studio'
    return new URL(url).hostname
  }

  // 随机User-Agent
  function getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ]
    return userAgents[Math.floor(Math.random() * userAgents.length)]
  }

  // HTTP请求函数
  async function http(opt = {}) {
    const METHOD = opt.method || $arguments.method || 'get'
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 8000)
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1)
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000)

    let count = 0
    const fn = async () => {
      try {
        return await $.http[METHOD]({ ...opt, timeout: TIMEOUT })
      } catch (e) {
        if (count < RETRIES) {
          count++
          const delay = RETRY_DELAY * count
          await $.wait(delay)
          return await fn()
        } else {
          throw e
        }
      }
    }
    return await fn()
  }

  // 生成缓存ID
  function getCacheId({ proxy = {}, urls }) {
    return `http-meta:multi-ai:${urls.join(',')}:${JSON.stringify(
      Object.fromEntries(Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key)))
    )}`
  }

  /**
   * 并发执行异步任务队列
   * 支持限制并发数和收集任务结果
   *
   * @param {Array<() => Promise>} tasks - 异步任务函数数组
   * @param {Object} options - 配置选项
   * @param {boolean} [options.wrap=false] - 是否用 {data} 或 {error} 包装结果
   * @param {boolean} [options.result=false] - 是否收集并返回所有任务结果
   * @param {number} [options.concurrency=1] - 最大并发数
   * @returns {Promise<Array|undefined>} - 当 result=true 时返回结果数组,否则返回 undefined
   *
   * @example
   * // 并发执行 AI 检测任务,限制并发数为 5,收集结果
   * await executeAsyncTasks(
   *   proxies.map(proxy => () => checkMultipleUrls(proxy)),
   *   { concurrency, result: true }
   * )
   */
  function executeAsyncTasks(tasks, { wrap, result, concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0
        const results = []
        let index = 0

        function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++
            const currentTask = tasks[taskIndex]
            running++

            currentTask()
              .then(data => {
                if (result) {
                  results[taskIndex] = wrap ? { data } : data
                }
              })
              .catch(error => {
                if (result) {
                  results[taskIndex] = wrap ? { error } : error
                }
              })
              .finally(() => {
                running--
                executeNextTask()
              })
          }

          if (running === 0) {
            return resolve(result ? results : undefined)
          }
        }

        await executeNextTask()
      } catch (e) {
        reject(e)
      }
    })
  }
}
