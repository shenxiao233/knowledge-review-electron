# 知识管理与复习工具

Electron 桌面端知识管理与间隔重复复习原型，界面参考提供的浅色知识库工作台设计图，包含文档库、卡片库、复习、回收站、插件市场、个人中心和设置页面。

## 运行

```bash
npm install --cache .npm-cache
npm run doctor
npm run dev
```

项目已包含 `.npmrc`，会把 npm 缓存和 Electron 下载缓存放在项目内，并使用 npmmirror 的 Electron 镜像，避免系统级缓存权限错误。

## 校验

```bash
npm run check
npm run doctor
```

## 文档

完整使用说明和已实现功能见：

- `docs/使用说明书与已实现功能.md`
