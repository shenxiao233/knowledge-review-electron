# 后端接口与前端功能清单

以下接口已经存在于后端，但当前桌面端没有完整业务入口，后续可以按产品优先级补齐。

## 高优先级

- `POST /api/v2/sync`、`POST /api/v2/sync/batch`、`GET /api/v2/sync/full`、`GET /api/v2/sync/history`：多设备同步界面尚未接入 V2 同步对象、冲突解决和历史回滚。
- `GET /api/v2/me/profile`、`POST/PATCH /api/v2/me/profile`：资料页仍以本地状态为主，头像、昵称、简介没有完整服务器读写链路。
- `POST/GET/DELETE /api/v2/invitations`、`POST /api/v2/invitations/validate`：邀请码管理和注册邀请流程没有前端管理入口。
- `POST /api/v2/decks/:id/fork`、commits、pull requests、reviews、merge、comments、collaborators：协作牌组能力只有后端接口，桌面端没有协作工作区。

## 中优先级

- `GET/POST/DELETE /api/v1/decks/:id/reviews`：公开牌组评价和评论界面未实现。
- `GET /api/v1/decks/:id`、`GET /api/v1/decks/:id/changelog`：牌组详情和版本历史没有独立浏览页，当前仅在详情弹窗中检查更新。
- `GET/PATCH /api/v2/me/devices`：设备列表、设备撤销和设备同步状态没有管理界面。
- `GET /api/v2/sync/device/:deviceId`、`DELETE /api/v2/sync/:objectType/:objectId`：设备同步对象的定向操作没有前端入口。

## 管理后台补充

- `GET /api/v1/admin/audit-stats`、`POST /api/v1/admin/archive-audit`：审计统计和归档操作尚未接入；当前后台已接入基础日志查询。
- 分类接口仍保留用于旧客户端兼容，但新上传、公开牌组筛选和后台流程已取消分类概念，前端不再调用这些接口。

## 已接入

登录、注册、密码修改、公开牌组搜索/下载/更新检查、我的牌组上传与版本更新、收藏、管理员用户/牌组审核、审计日志、存储检查和存储清理已经有前端入口。
