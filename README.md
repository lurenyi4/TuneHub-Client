# TuneHub-Client

🎵 **TuneHub** 是一个统一的音乐信息解析服务前端应用，支持多平台音乐搜索、播放、下载和管理。

## 📋 项目概述

TuneHub-Client 是一个功能完整的音乐客户端应用，具备以下核心功能：

- 🔍 **多平台音乐搜索**：支持网易云音乐、酷我音乐、QQ音乐的聚合搜索
- 🎵 **在线音乐播放**：支持多种音质选择（128k/320k/FLAC/Hi-Res）
- 💾 **本地音乐库管理**：自动扫描和管理本地音乐文件
- 📋 **歌单功能**：支持歌单解析、批量保存和播放
- 📊 **播放统计**：详细的播放历史和统计数据
- 🎨 **现代化界面**：支持明暗主题切换，响应式设计
- 🎛️ **高级功能**：排行榜浏览、音频可视化、快捷键支持

## 🏗️ 技术架构

### 前端技术栈
- **HTML5/CSS3/JavaScript**：现代化Web技术
- **响应式设计**：适配桌面和移动设备
- **Web Audio API**：音频可视化和播放控制
- **LocalStorage**：本地数据持久化

### 后端技术栈
- **Node.js + Express**：轻量级服务器框架
- **Axios**：HTTP客户端，用于API代理
- **CORS**：跨域资源共享支持
- **文件系统操作**：本地音乐库管理

### 核心依赖
```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "jest": "^30.2.0"
  }
}
```

## 🚀 快速开始

### 环境要求

- **Node.js**: v14.0.0 或更高版本
- **npm**: v6.0.0 或更高版本
- **操作系统**: Windows/macOS/Linux

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd TuneHub-Client
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```

4. **生产环境启动**
   ```bash
   npm start
   ```

### 访问应用

启动成功后，在浏览器中访问：
```
http://localhost:3000
```

## 📁 项目结构

```
TuneHub-Client/
├── public/                    # 前端静态资源
│   ├── index.html            # 主页面
│   ├── app.js               # 前端核心逻辑
│   └── styles.css           # 样式文件
├── storage/                  # 本地音乐存储目录
│   ├── kuwo/               # 酷我音乐缓存
│   ├── netease/            # 网易云音乐缓存
│   ├── play_history.json   # 播放历史
│   └── playlist_history.json # 歌单历史
├── server.js                # 后端服务器入口
├── storage-utils.js         # 存储管理工具
├── history-utils.js         # 历史记录管理
├── playlist-history-utils.js # 歌单历史管理
├── package.json            # 项目配置和依赖
└── README.md              # 项目文档
```

## ⚙️ 配置说明

### 环境变量

项目支持以下环境变量配置：

- `PORT`: 服务器端口号（默认：3000）
- `NODE_ENV`: 运行环境（development/production）

### API配置

项目使用外部音乐API服务：
- **API_BASE_URL**: `https://music-dl.sayqz.com`
- 支持的音乐平台：网易云音乐、酷我音乐、QQ音乐

## 🎮 功能使用指南

### 1. 音乐搜索

1. 在搜索框中输入歌曲名或歌手名
2. 选择搜索平台（支持聚合搜索）
3. 点击搜索按钮或按回车键
4. 点击搜索结果中的歌曲即可播放

### 2. 歌单功能

1. 切换到"歌单"标签页
2. 选择音乐平台并输入歌单ID
3. 点击"加载歌单"按钮
4. 可以播放全部歌曲或保存到本地

### 3. 本地音乐库

1. 切换到"本地库"标签页
2. 点击"刷新列表"扫描本地音乐
3. 使用搜索框过滤本地歌曲
4. 点击歌曲即可播放

### 4. 播放控制

- **播放/暂停**：空格键或点击播放按钮
- **上一首/下一首**：← → 方向键
- **音量控制**：↑ ↓ 方向键
- **搜索框聚焦**：/ 键
- **关闭歌词界面**：Esc键

### 5. 音质选择

在播放器右侧的下拉菜单中选择音质：
- 128k：标准音质
- 320k：高品质
- FLAC：无损音质
- Hi-Res：高解析音质

## 🔧 部署指南

### 本地部署

1. **安装Node.js环境**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # CentOS/RHEL
   curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
   sudo yum install -y nodejs
   
   # macOS (使用Homebrew)
   brew install node@18
   ```

2. **部署应用**
   ```bash
   # 克隆代码
   git clone <repository-url>
   cd TuneHub-Client
   
   # 安装依赖
   npm install
   
   # 启动服务
   npm start
   ```

### 生产环境部署

#### 使用PM2进程管理

1. **安装PM2**
   ```bash
   npm install -g pm2
   ```

2. **启动应用**
   ```bash
   pm2 start server.js --name "tunehub-client" --env production
   ```

3. **设置开机自启**
   ```bash
   pm2 startup
   pm2 save
   ```

#### 使用Docker部署

1. **创建Dockerfile**
   ```dockerfile
   FROM node:18-alpine
   
   WORKDIR /app
   
   COPY package*.json ./
   RUN npm install --production
   
   COPY . .
   
   EXPOSE 3000
   
   CMD ["npm", "start"]
   ```

2. **构建和运行**
   ```bash
   docker build -t tunehub-client .
   docker run -d -p 3000:3000 --name tunehub tunehub-client
   ```

### Nginx反向代理配置

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # WebSocket支持
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 📊 API接口说明

### 音乐相关接口

- `GET /api/proxy/search` - 音乐搜索
- `GET /api/proxy/info` - 获取歌曲信息
- `GET /api/proxy/url` - 获取播放地址
- `GET /api/proxy/pic` - 获取专辑封面
- `GET /api/proxy/lrc` - 获取歌词

### 本地库接口

- `GET /api/local/library` - 获取本地音乐库
- `GET /api/storage/stats` - 获取存储统计

### 历史记录接口

- `GET /api/history` - 获取播放历史
- `POST /api/history` - 添加播放历史
- `DELETE /api/history` - 清空播放历史

### 歌单接口

- `GET /api/proxy/playlist` - 获取歌单信息
- `POST /api/playlist/save-all` - 批量保存歌单

## 🔒 安全考虑

1. **CORS配置**：已启用CORS支持，允许跨域请求
2. **请求限制**：设置了500MB的请求体大小限制
3. **文件路径安全**：使用文件名清理函数防止路径遍历攻击
4. **错误处理**：完善的错误处理和用户友好的错误提示

## 🚨 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # 查找占用端口的进程
   lsof -i :3000
   # 或
   netstat -tlnp | grep 3000
   
   # 修改端口
   PORT=3001 npm start
   ```

2. **依赖安装失败**
   ```bash
   # 清除缓存重新安装
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **文件权限问题**
   ```bash
   # 确保storage目录可写
   chmod -R 755 storage
   ```

### 日志查看

- **应用日志**：控制台输出
- **错误日志**：server.js中的错误处理中间件
- **访问日志**：Express默认请求日志

## 🤝 贡献指南

1. Fork 项目到你的GitHub账户
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -am 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 提交Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🆘 支持与反馈

- 提交Issue：报告bug或功能建议
- 查看文档：详细的API文档和使用指南
- 社区讨论：参与功能讨论和改进建议

---

**TuneHub-Client** - 让音乐触手可及 🎵