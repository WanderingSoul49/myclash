// 说明：1、该配置代码已经备份在 GitHub Gist 上；2、使用仅需要在 parser 中做如下配置：3、根据 CFW 文档，既可以引用本地 js，也可以使用 Gist 远程 raw url
/* 
  parsers: # array
    - reg: https://.*$
      file: "/Users/xxxx/.config/clash/parser.js"
*/
module.exports.parse = async (
  raw,
  { axios, yaml, notify, console },
  { name, url, interval, selected }
) => {
  // get the raw config from subcribed profile
  const rawProfileObj = yaml.parse(raw);
  // 提取订阅链接中的节点列表
  const proxies = rawProfileObj.proxies.map((proxy) => proxy.name);

  // declare proxy groups
  const proxyGroups = [];

  // push my custom proxy groups.
  proxyGroups.push(
    {
      name: "PROXY",
      type: "select",
      proxies: ["URL-TEST", "LOAD-BALANCE", "SELECT", "DIRECT"],
    },
    {
      name: "OTHER", //规则未命中
      type: "select",
      proxies: ["PROXY", "DIRECT"],
    },
    {
      name: "AD",
      type: "select",
      proxies: ["REJECT", "DIRECT", "PROXY"],
    },
    {
      name: "URL-TEST",
      type: "url-test",
      url: "http://www.gstatic.com/generate_204",
      interval: 300,
      lazy: true,
      tolerance: 50,
      proxies: proxies,
    },
    {
      name: "LOAD-BALANCE",
      type: "load-balance",
      url: "http://www.gstatic.com/generate_204",
      interval: 180,
      proxies: proxies,
    },
    {
      name: "SELECT",
      type: "select",
      proxies: proxies,
    }
  );

  // 给 proxy-groups 添加一个策略组，过滤掉带有特定字样的节点
  const notIncludedFully = ["新加坡", "新加坡-9", "新加坡-9-2"];
  const notIncludedPartly = ["香港", "日本", "圣何塞"];
  const filteredProxies4AI = proxies.filter(
    (proxy) =>
      notIncludedFully.indexOf(proxy) === -1 &&
      notIncludedPartly.every((keyword) => !proxy.includes(keyword))
  );

  proxyGroups.push({
    name: "URL-TEST-AI",
    type: "url-test",
    url: "http://www.gstatic.com/generate_204",
    interval: 300,
    lazy: true,
    tolerance: 50,
    proxies: filteredProxies4AI,
  });

  // final result
  let result = {
    ...rawProfileObj,
    "proxy-groups": proxyGroups,
  };

  // set rules and rule providers
  const urlRule =
    "https://gist.githubusercontent.com/puppetdevz/ba94db6d192908bda07b8fb43e63cb24/raw/9e775767ae45fe0e60e65f65dddd055c042f4e88/remote_rules.yml";
  const { status, data } = await axios.get(urlRule);
  if (status !== 200) {
    console.log("error " + status);
    return yaml.stringify(result);
  }
  const ruleObj = yaml.parse(data);
  console.log(ruleObj);

  result.rules = ruleObj["prepend-rules"]
  result["rule-providers"] = ruleObj["mix-rule-providers"]
  return yaml.stringify(result);
};
