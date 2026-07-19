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

## 发布与自动更新

正式版本使用 GitHub Releases 发布。先修改 `package.json` 的版本号，然后提交版本标签：

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions 会自动构建 Windows 安装包并发布 Release。已安装客户端会从 GitHub Releases 检查更新，后台流式下载，下载完成后提示重启安装。

用户数据保存在 Electron 用户数据目录（Windows 通常为 `%APPDATA%\KnowledgeReview`），不在安装目录内。旧版本项目中的 `runtime-data` 会在首次启动时迁移；迁移采用复制方式，旧目录不会被删除。NSIS 卸载配置也不会删除用户数据。

本地构建安装包：

```bash
npm run build
```

## 文档

完整使用说明和已实现功能见：

- `docs/使用说明书与已实现功能.md`
