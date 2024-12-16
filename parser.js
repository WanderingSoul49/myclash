// 说明：使用仅需要在 parser 中做如下配置；根据 CFW 文档，既可以引用本地 js，也可以使用 Gist 远程 raw url
/*
  parsers: # array
    - reg: https://.*$
      file: "/Users/xxxx/.config/clash/parser.js"
*/
module.exports.parse = async (raw, { axios, yaml, notify, console }, { name, url, interval, selected }) => {
  // get the raw config from subcribed profile
  const mainProfile = yaml.parse(raw)
  let proxies = mainProfile.proxies

  // requet other profile for merging into one profile
  const urlProfiles = []
  // 公开、废弃
  // const urlProfiles = ['https://v2.bruceyunti.net/api/v1/client/subscribe?token=5ac351fff']
  for (let i = 0; i < urlProfiles.length; i++) {
    const { status: otherProfileRequestStatus, data: otherProfileData } = await axios.get(urlProfiles[i])
    if (otherProfileRequestStatus === 200) {
      const parsedOtherProfileData = yaml.parse(otherProfileData)
      // console.log(parsedOtherProfileData.proxies)
      proxies = proxies.concat(parsedOtherProfileData.proxies)
    } else {
      console.log('请求 ${urlProfiles[i]} 失败')
    }
  }

  // 提取订阅链接中的节点列表
  // console.log(proxies)
  const proxyNames = proxies.map(proxy => proxy.name)
  // console.log(proxyNames)

  // declare proxy groups
  const proxyGroups = []

  // 给 proxy-groups 添加一个策略组，过滤掉带有特定字样的节点
  const notIncludedFullyMatch = ['德国-15']
  const notIncludedPartlyMatch = ['香港', '日本']
  // have the highest priority. if onlyIncluded is not none, then just use the node of onlyIncluded
  const onlyIncludedFullyMatch = ['新加坡-3', '新加坡-9', '新加坡-9-2']
  const onlyIncludedPartlyMatch = ['新加坡!新加坡', '美国'] // Filter nodes that contain xxx but except for the full name yyy, eg.['新加坡!新加坡-1!Singapore-2']
  // the filter result array
  let proxyNames4LLM = []
  // judge whether the onluInclude is empty by length.
  if (onlyIncludedFullyMatch.length > 0 || onlyIncludedPartlyMatch.length > 0) {
    proxyNames4LLM = proxyNames.filter(
      proxyName =>
        onlyIncludedFullyMatch.indexOf(proxyName) >= 0 ||
        onlyIncludedPartlyMatch.some(keyword => {
          const words = keyword.split('!')
          if (words.length < 1) return proxyName.includes(words[0])
          else return proxyName.includes(words.shift()) && words.indexOf(proxyName) === -1
        }),
    )
  } else {
    proxyNames4LLM = proxyNames.filter(
      proxyName =>
        notIncludedFullyMatch.indexOf(proxyName) === -1 &&
        notIncludedPartlyMatch.every(keyword => !proxyName.includes(keyword)),
    )
  }
  // console.log('The filteredProxies4LLM is ', filteredProxies4LLM)

  // push the proxy group for LLM website
  proxyGroups.push(
    {
      name: 'LLM',
      type: 'select',
      proxies: ['URL-TEST-LLM', 'SELECT-LLM'],
    },
    {
      name: 'URL-TEST-LLM',
      type: 'url-test',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      lazy: true,
      tolerance: 50,
      proxies: proxyNames4LLM,
    },
    {
      name: 'SELECT-LLM',
      type: 'select',
      proxies: proxyNames4LLM,
    },
  )

  // push other my custom proxy groups.
  proxyGroups.push(
    {
      name: 'PROXY',
      type: 'select',
      proxies: ['URL-TEST', 'LOAD-BALANCE', 'SELECT', 'DIRECT'],
    },
    {
      name: 'OTHER', //规则未命中
      type: 'select',
      proxies: ['PROXY', 'DIRECT'],
    },
    {
      name: 'AD',
      type: 'select',
      proxies: ['REJECT', 'DIRECT', 'PROXY'],
    },
    {
      name: 'URL-TEST',
      type: 'url-test',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      lazy: true,
      tolerance: 50,
      proxies: proxyNames,
    },
    {
      name: 'LOAD-BALANCE',
      type: 'load-balance',
      url: 'http://www.gstatic.com/generate_204',
      interval: 180,
      proxies: proxyNames,
    },
    {
      name: 'SELECT',
      type: 'select',
      proxies: proxyNames,
    },
  )

  // final result
  let result = {
    ...mainProfile,
    proxies,
    'proxy-groups': proxyGroups,
  }

  // set rules and rule providers
  const fs = require('fs')
  const path = require('path')
  let ruleData
  try {
    // console.log(__dirname);
    ruleData = fs.readFileSync(path.join(__dirname, 'rules.yaml'), 'utf8')
    // console.log(ruleData);
  } catch (err) {
    console.error(err)
    return yaml.stringify(result)
  }

  const ruleObj = yaml.parse(ruleData)
  // console.log(ruleObj);

  result.rules = ruleObj['prepend-rules']
  result['rule-providers'] = ruleObj['mix-rule-providers']
  return yaml.stringify(result)
}
