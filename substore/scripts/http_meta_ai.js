/**
 *
 * AI 连通性检测 (适配 Sub-Store Node.js 版)
 *
 * 该脚本用于检测代理节点是否能访问主流 AI 服务, 包括:
 * 1. OpenAI (ChatGPT)
 * 2. Anthropic (Claude)
 * 3. Google (Gemini)
 *
 * 只有当一个节点 **同时** 通过所有服务的检测时, 才会被标记上前缀.
 *
 * Surge/Loon 版 请查看: https://t.me/zhetengsha/1207
 * 欢迎加入 Telegram 群组 https://t.me/zhetengsha
 *
 * HTTP META(https://github.com/xream/http-meta) 参数
 * - [http_meta_protocol] 协议 默认: http
 * - [http_meta_host] 服务地址 默认: 127.0.0.1
 * - [http_meta_port] 端口号 默认: 9876
 * - [http_meta_authorization] Authorization 默认无
 * - [http_meta_start_delay] 初始启动延时(单位: 毫秒) 默认: 3000
 * - [http_meta_proxy_timeout] 每个节点耗时(单位: 毫秒). 此参数是为了防止脚本异常退出未关闭核心. 设置过小将导致核心过早退出. 目前逻辑: 启动初始的延时 + 每个节点耗时. 默认: 10000
 *
 * 其它参数
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [method] 请求方法. 默认 get
 * - [ai_prefix] 显示前缀. 默认为 "[AI] "
 * - [cache] 使用缓存, 默认不使用缓存
 * - [disable_failed_cache/ignore_failed_error] 禁用失败缓存. 即不缓存失败结果
 *
 * 注:
 * - 节点上会添加一个 _ai_check 字段 (true/false), 可用于脚本筛选.
 * - 新增 _latencies 字段, 记录了每个 AI 服务的响应延迟, 例如: { "gpt": 120, "claude": 150, "gemini": 100 }
 *
 * 关于缓存时长
 * 当使用相关脚本时, 若在对应的脚本中使用参数开启缓存, 可设置持久化缓存 sub-store-csr-expiration-time 的值来自定义默认缓存时长, 默认为 172800000 (48 * 3600 * 1000, 即 48 小时)
 *
 */

async function operator(proxies = [], targetPlatform, context) {
  const cacheEnabled = $arguments.cache;
  const disableFailedCache = $arguments.disable_failed_cache || $arguments.ignore_failed_error;
  const cache = scriptResourceCache;
  const http_meta_host = $arguments.http_meta_host ?? "127.0.0.1";
  const http_meta_port = $arguments.http_meta_port ?? 9876;
  const http_meta_protocol = $arguments.http_meta_protocol ?? "http";
  const http_meta_authorization = $arguments.http_meta_authorization ?? "";
  const http_meta_api = `${http_meta_protocol}://${http_meta_host}:${http_meta_port}`;
  const http_meta_start_delay = parseFloat($arguments.http_meta_start_delay ?? 3000);
  const http_meta_proxy_timeout = parseFloat($arguments.http_meta_proxy_timeout ?? 10000);
  const aiPrefix = $arguments.ai_prefix ?? "[AI] ";
  const method = $arguments.method || "get";

  // 定义所有需要检测的 AI 服务
  const targets = [
    {
      name: "gpt",
      url: "https://ios.chat.openai.com", // 使用 iOS 端点进行检测
      successCondition: (status, body) => {
        // 403 并且响应体中不包含 "unsupported_country" 表示地区解锁
        const msg = body?.error?.code || body?.error?.error_type || body?.cf_details;
        return status === 403 && !/unsupported_country/.test(msg);
      },
    },
    {
      name: "claude",
      url: "https://claude.ai/login", // 检测 Claude 登录页
      successCondition: (status, body) => {
        // 能正常访问登录页面，状态码为 200
        return status === 200;
      },
    },
    {
      name: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/models", // 检测 Gemini API 端点
      successCondition: (status, body) => {
        // 未被墙的 IP 访问会返回 404 (无 API Key) 或 400 (请求格式错误), 被墙则超时或返回其他错误
        return status === 404 || status === 400;
      },
    },
  ];

  const $ = $substore;
  const internalProxies = [];
  proxies.forEach((proxy, index) => {
    try {
      const node = ProxyUtils.produce([{ ...proxy }], "ClashMeta", "internal")?.[0];
      if (node) {
        for (const key in proxy) {
          if (/^_/i.test(key)) {
            node[key] = proxy[key];
          }
        }
        internalProxies.push({ ...node, _proxies_index: index });
      }
    } catch (e) {
      $.error(e);
    }
  });

  $.info(`核心支持节点数: ${internalProxies.length}/${proxies.length}`);
  if (!internalProxies.length) return proxies;

  if (cacheEnabled) {
    try {
      let allCached = true;
      for (let i = 0; i < internalProxies.length; i++) {
        const proxy = internalProxies[i];
        const id = getCacheId({
          proxy,
        });
        const cached = cache.get(id);
        if (cached) {
          if (cached.success) {
            proxies[proxy._proxies_index].name = `${aiPrefix}${proxies[proxy._proxies_index].name}`;
            proxies[proxy._proxies_index]._ai_check = true;
            proxies[proxy._proxies_index]._latencies = cached.latencies;
          } else if (disableFailedCache) {
            allCached = false;
            break;
          }
        } else {
          allCached = false;
          break;
        }
      }
      if (allCached) {
        $.info("所有节点都有有效缓存, 检测完成");
        return proxies;
      }
    } catch (e) {
      $.error(`缓存检查出错: ${e}`);
    }
  }

  const http_meta_timeout = http_meta_start_delay + internalProxies.length * http_meta_proxy_timeout;

  let http_meta_pid;
  let http_meta_ports = [];
  // 启动 HTTP META
  const startRes = await http({
    retries: 0,
    method: "post",
    url: `${http_meta_api}/start`,
    headers: {
      "Content-type": "application/json",
      Authorization: http_meta_authorization,
    },
    body: JSON.stringify({
      proxies: internalProxies,
      timeout: http_meta_timeout,
    }),
  });

  let startBody = startRes.body;
  try {
    startBody = JSON.parse(startBody);
  } catch (e) {}

  const { ports, pid } = startBody;
  if (!pid || !ports) {
    throw new Error(`======== HTTP META 启动失败 ====\n${startBody}`);
  }
  http_meta_pid = pid;
  http_meta_ports = ports;
  $.info(
    `\n======== HTTP META 启动 ====\n[端口] ${ports}\n[PID] ${pid}\n[超时] 若未手动关闭, ${
      Math.round(http_meta_timeout / 60 / 100) / 10
    } 分钟后自动关闭\n`
  );
  $.info(`等待 ${http_meta_start_delay / 1000} 秒后开始检测`);
  await $.wait(http_meta_start_delay);

  const concurrency = parseInt($arguments.concurrency || 10);
  await executeAsyncTasks(
    internalProxies.map(proxy => () => check(proxy)),
    {
      concurrency,
    }
  );

  // 关闭 HTTP META
  try {
    const stopRes = await http({
      method: "post",
      url: `${http_meta_api}/stop`,
      headers: {
        "Content-type": "application/json",
        Authorization: http_meta_authorization,
      },
      body: JSON.stringify({
        pid: [http_meta_pid],
      }),
    });
    $.info(`\n======== HTTP META 关闭 ====\n${JSON.stringify(JSON.parse(stopRes.body), null, 2)}`);
  } catch (e) {
    $.error(`HTTP META 关闭失败: ${e}`);
  }

  return proxies;

  async function check(proxy) {
    const id = cacheEnabled
      ? getCacheId({
          proxy,
        })
      : undefined;
    try {
      if (cacheEnabled) {
        const cached = cache.get(id);
        if (cached) {
          if (cached.success) {
            proxies[proxy._proxies_index].name = `${aiPrefix}${proxies[proxy._proxies_index].name}`;
            proxies[proxy._proxies_index]._ai_check = true;
            proxies[proxy._proxies_index]._latencies = cached.latencies;
            $.info(`[${proxy.name}] 使用成功缓存`);
            return;
          } else if (disableFailedCache) {
            $.info(`[${proxy.name}] 不使用失败缓存`);
          } else {
            $.info(`[${proxy.name}] 使用失败缓存`);
            // 为节点添加失败标记
            proxies[proxy._proxies_index]._ai_check = false;
            return;
          }
        }
      }

      const latencies = {};
      let allPassed = true;

      for (const target of targets) {
        const index = internalProxies.indexOf(proxy);
        const startedAt = Date.now();
        let status, body;

        try {
          const res = await http({
            proxy: `http://${http_meta_host}:${http_meta_ports[index]}`,
            method,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
            },
            url: target.url,
          });
          status = parseInt(res.status || res.statusCode || 200);
          body = String(res.body ?? res.rawBody);
          try {
            body = JSON.parse(body);
          } catch (e) {
            /* 不是 JSON 格式, 忽略错误 */
          }
        } catch (err) {
          $.info(`[${proxy.name}] -> [${target.name.toUpperCase()}] 检测失败: ${err.message}`);
          allPassed = false;
          break; // 任何一个服务网络层失败，则中止该节点的检测
        }

        const latency = Date.now() - startedAt;
        if (target.successCondition(status, body)) {
          $.info(`[${proxy.name}] -> [${target.name.toUpperCase()}] 检测通过 (延迟: ${latency}ms)`);
          latencies[target.name] = latency;
        } else {
          $.info(`[${proxy.name}] -> [${target.name.toUpperCase()}] 检测不通过 (Status: ${status})`);
          allPassed = false;
          break; // 任何一个服务业务层不满足条件，则中止该节点的检测
        }
      }

      const originalProxy = proxies[proxy._proxies_index];
      if (allPassed) {
        originalProxy.name = `${aiPrefix}${originalProxy.name}`;
        originalProxy._ai_check = true;
        originalProxy._latencies = latencies;
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置成功缓存`);
          cache.set(id, {
            success: true,
            latencies: latencies,
          });
        }
      } else {
        originalProxy._ai_check = false;
        if (cacheEnabled) {
          $.info(`[${proxy.name}] 设置失败缓存`);
          cache.set(id, {
            success: false,
          });
        }
      }
    } catch (e) {
      $.error(`[${proxy.name}] 检测时发生未知错误: ${e.message ?? e}`);
      proxies[proxy._proxies_index]._ai_check = false;
      if (cacheEnabled) {
        $.info(`[${proxy.name}] 因错误设置失败缓存`);
        cache.set(id, {
          success: false,
        });
      }
    }
  }

  async function http(opt = {}) {
    const METHOD = opt.method || $arguments.method || "get";
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 5000);
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1);
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000);

    let count = 0;
    const fn = async () => {
      try {
        return await $.http[METHOD]({ ...opt, timeout: TIMEOUT });
      } catch (e) {
        if (count < RETRIES) {
          count++;
          const delay = RETRY_DELAY * count;
          await $.wait(delay);
          return await fn();
        } else {
          throw e;
        }
      }
    };
    return await fn();
  }

  function getCacheId({ proxy = {} }) {
    // 缓存 Key 不再包含 URL, 因为是综合检测
    return `http-meta:ai-check:${JSON.stringify(
      Object.fromEntries(Object.entries(proxy).filter(([key]) => !/^(name|collectionName|subName|id|_.*)$/i.test(key)))
    )}`;
  }

  function executeAsyncTasks(tasks, { concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0;
        let index = 0;
        const results = [];

        function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++;
            const currentTask = tasks[taskIndex];
            running++;
            currentTask().finally(() => {
              running--;
              executeNextTask();
            });
          }
          if (running === 0 && index === tasks.length) {
            resolve();
          }
        }
        await executeNextTask();
      } catch (e) {
        reject(e);
      }
    });
  }
}
