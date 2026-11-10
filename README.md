# 图可开单打印

档口开单、小票、蓝牙打印和云打印的微信小程序客户端。

- 基础库：3.16.2
- 语言：TypeScript
- 当前源码版本：2.0.17（构建 166）

## 打开

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入本仓库目录
3. 在仓库根目录执行 `npm install`
4. 需要 TypeScript 检查时执行 `npm run typecheck`
5. 需要重新转译时执行 `npm run transpile`

`project.config.json` 里的 AppID 是图可开单打印的小程序。本仓库不含上传密钥，不能用它上传代码。

## 接口

客户端请求 `https://api.imageok.cn`。本仓库只有客户端，没有服务端。登录、开单和打印依赖该服务。

## 版权

保留所有权利。源码可以在 GitHub 上查看。未经许可，不得用于商业产品，不得再分发。详见 [LICENSE](./LICENSE)。
