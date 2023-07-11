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

  // 给 proxy-groups 添加一个策略组，过滤掉带有特定字样的节点
  const notIncludedFullyMatch = ["德国-15"];
  const notIncludedPartlyMatch = [
    "香港",
    "日本",
    "圣何塞",
    "印度",
    "首尔",
    "美国",
    "春川",
  ];
  // have the highest priority. if onlyIncluded is not none, then just use the node of onlyIncluded
  const onlyIncludedFullyMatch = ["新加坡"];
  const onlyIncludedPartlyMatch = ["新加坡"];
  // the filter result array
  let filteredProxies4AI = [];
  // judge whether the onluInclude is empty by length.
  if (onlyIncludedFullyMatch.length > 0 || onlyIncludedPartlyMatch.length > 0) {
    filteredProxies4AI = proxies.filter(
      (proxy) =>
        onlyIncludedFullyMatch.indexOf(proxy) >= 0 ||
        onlyIncludedPartlyMatch.some((keyword) => proxy.includes(keyword))
    );
  } else {
    filteredProxies4AI = proxies.filter(
      (proxy) =>
        notIncludedFullyMatch.indexOf(proxy) === -1 &&
        notIncludedPartlyMatch.every((keyword) => !proxy.includes(keyword))
    );
  }
  console.log("The filter result is ", filteredProxies4AI);

  // push the proxy group for ai website
  proxyGroups.push(
    {
      name: "AI",
      type: "select",
      proxies: ["URL-TEST-AI", "SELECT-AI"],
    },
    {
      name: "URL-TEST-AI",
      type: "url-test",
      url: "http://www.gstatic.com/generate_204",
      interval: 300,
      lazy: true,
      tolerance: 50,
      proxies: filteredProxies4AI,
    },
    {
      name: "SELECT-AI",
      type: "select",
      proxies: filteredProxies4AI,
    }
  );

  // push other my custom proxy groups.
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

  // final result
  let result = {
    ...rawProfileObj,
    "proxy-groups": proxyGroups,
  };

  // set rules and rule providers
  // const urlRule =
  //   "https://gist.githubusercontent.com/puppetdevz/ba94db6d192908bda07b8fb43e63cb24/raw/9e775767ae45fe0e60e65f65dddd055c042f4e88/remote_rules.yml";
  // const { status, ruleData } = await axios.get(urlRule);
  // if (status !== 200) {
  //   console.log("error " + status);
  //   return yaml.stringify(result);
  // }
  const fs = require("fs");
  const path = require("path");
  let ruleData;
  try {
    // console.log(__dirname);
    ruleData = fs.readFileSync(path.join(__dirname, "rules.yaml"), "utf8");
    // console.log(ruleData);
  } catch (err) {
    console.error(err);
    return yaml.stringify(result);
  }

  const ruleObj = yaml.parse(ruleData);
  // console.log(ruleObj);

  result.rules = ruleObj["prepend-rules"];
  result["rule-providers"] = ruleObj["mix-rule-providers"];
  return yaml.stringify(result);
};
