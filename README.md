# 加班记录

一个人的上下班打卡与加班统计网页：手机浏览器打开，按服务器时间打卡，自动按周期统计加班并识别中国法定节假日与调休。

## 环境要求

- Docker 20.10+，Docker Compose v2（`docker compose`）
- 服务器建议为 Linux x86_64/arm64；本机用 Docker Desktop 也可以
- 默认对外端口 `8080`，如被占用可修改 `docker-compose.yml` 中的端口映射

## 构建与启动

在仓库根目录执行：

```bash
INITIAL_PASSWORD='你的初始密码' docker compose up -d --build
```

PowerShell：

```powershell
$env:INITIAL_PASSWORD="你的初始密码"; docker compose up -d --build
```

启动后访问 `http://<服务器地址>:8080`。查看日志与健康状态：

```bash
docker compose logs -f app
docker compose ps
```

也可以不用 Compose，直接构建和运行：

```bash
docker build -t overtime-tracker .
docker run -d --name overtime-tracker \
  -e INITIAL_PASSWORD='你的初始密码' \
  -e TZ=Asia/Shanghai \
  -p 8080:3000 \
  -v "$PWD/data:/app/data" \
  overtime-tracker
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `INITIAL_PASSWORD` | 是 | 无 | 首次初始化数据库时写入的登录密码；之后修改密码不会受该变量影响 |
| `DB_PATH` | 否 | `data/overtime.db` | SQLite 数据库路径；容器内由 Compose 设为 `/app/data/overtime.db` |
| `PORT` | 否 | `3000` | 服务监听端口；容器内保持 3000，由端口映射对外 |
| `TZ` | 否 | `Asia/Shanghai` | 时区；打卡时间与“今天”以服务器时间、上海时区为准 |

`INITIAL_PASSWORD` 只在数据库尚未设置密码时生效。如果启动时没有设置，登录会提示“尚未配置密码”。Compose 使用 `${INITIAL_PASSWORD:?set INITIAL_PASSWORD}`，未提供时直接报错退出，避免起一个无法登录的服务。

## 首次登录

1. 打开 `http://<服务器地址>:8080`。
2. 输入 `INITIAL_PASSWORD` 登录。
3. 进入“设置”修改密码（新密码至少 8 位），然后开始打卡。

## 数据与备份

- 所有打卡记录、设置、会话和节假日缓存都在 SQLite 数据库中。
- Compose 将宿主机 `./data` 挂载到容器 `/app/data`，数据库文件为 `data/overtime.db`；内置节假日快照在镜像的 `/app/assets/chinese-days.json`，不随数据卷变化。
- 备份：先停止服务，再拷贝数据库，避免 WAL 写入过程中复制。

  ```bash
  mkdir -p backups
  docker compose stop
  cp data/overtime.db backups/overtime-$(date +%F).db
  docker compose start
  ```

  若目录中存在 `overtime.db-wal` / `overtime.db-shm`，请一并拷贝，或直接备份整个 `data/` 目录。恢复时把文件放回 `./data` 再启动即可。

## 节假日数据

- 镜像内置一份节假日快照，首次启动时写入数据库，离线也能用。
- 服务启动后会从公共 CDN（jsDelivr 上的 `chinese-days`）自动拉取，之后每 7 天更新一次；拉取失败只记录警告并继续使用已有数据。
- 设置页的“立即更新”按钮可手动刷新（对应 `POST /api/holidays/refresh`）；页面会显示数据覆盖范围和最后更新时间。
- 日期不在数据覆盖范围内时，按设置的“工作日”和兜底规则判断，不报错。

## 安全说明

本服务不提供 HTTPS，默认以明文 HTTP 暴露在映射端口上，仅适合个人在可信网络中使用。若需要公网访问，请自行放在带 TLS 的反向代理之后，并务必修改初始密码；不要在不可信网络中直接暴露明文端口。
