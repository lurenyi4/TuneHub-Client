const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

const STORAGE_DIR = path.join(__dirname, 'storage');

// 清理文件名中的非法字符
function sanitizeFileName(fileName) {
  if (!fileName) return '未知';
  // 替换Windows和Linux文件系统不支持的字符
  return fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '未知';
}

// 确保存储目录存在
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

// 获取歌曲存储目录路径（新结构：平台/歌手/专辑/歌曲名称）
function getSongStorageDir(source, artist, album, songName) {
  ensureStorageDir();
  const safeArtist = sanitizeFileName(artist || '未知歌手');
  const safeAlbum = sanitizeFileName(album || '未知专辑');
  const safeSongName = sanitizeFileName(songName || '未知歌曲');
  
  const songDir = path.join(STORAGE_DIR, source, safeArtist, safeAlbum, safeSongName);
  if (!fs.existsSync(songDir)) {
    fs.mkdirSync(songDir, { recursive: true });
  }
  return songDir;
}

// 获取歌曲存储路径
function getSongStoragePath(source, artist, album, songName, quality = '320k') {
  const songDir = getSongStorageDir(source, artist, album, songName);
  const safeSongName = sanitizeFileName(songName || '未知歌曲');
  
  // 根据音质确定文件扩展名
  let ext = '.mp3';
  if (quality === 'flac' || quality === 'flac24bit') {
    ext = '.flac';
  }
  
  return path.join(songDir, `${safeSongName}${ext}`);
}

// 获取歌词存储路径
function getLyricsStoragePath(source, artist, album, songName) {
  const songDir = getSongStorageDir(source, artist, album, songName);
  const safeSongName = sanitizeFileName(songName || '未知歌曲');
  return path.join(songDir, `${safeSongName}.lrc`);
}

// 获取专辑封面存储路径
function getCoverStoragePath(source, artist, album, songName) {
  const songDir = getSongStorageDir(source, artist, album, songName);
  const safeSongName = sanitizeFileName(songName || '未知歌曲');
  return path.join(songDir, `${safeSongName}.jpg`);
}

// 检查文件是否存在
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// 下载锁 Map
const songDownloadLocks = new Map();

// 确保歌曲已缓存（后台下载，带重试机制）
async function ensureSongCached(source, artist, album, songName, quality, audioUrl, onProgress, retryCount = 3) {
  const filePath = getSongStoragePath(source, artist, album, songName, quality);
  
  // 检查是否已有相同的下载任务在进行中
  if (songDownloadLocks.has(filePath)) {
    console.log(`任务已存在，复用下载任务: ${songName}`);
    return songDownloadLocks.get(filePath);
  }

  const downloadTask = (async () => {
    const tempPath = `${filePath}.tmp`;

    // 如果文件已存在，直接返回
    if (fileExists(filePath)) {
      if (onProgress) onProgress({ status: 'completed', progress: 100 });
      return;
    }

    let lastError = null;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        // 每次尝试前再次检查文件是否存在（可能被并发任务下载完成，或者之前的尝试其实成功了）
        if (fileExists(filePath)) {
          if (onProgress) onProgress({ status: 'completed', progress: 100 });
          return;
        }

        if (attempt > 0) {
          console.error(`正在重试下载 (${attempt}/${retryCount}): ${songName} (${artist})`);
          if (onProgress) onProgress({ status: 'downloading', progress: 0, message: `正在重试 (${attempt}/${retryCount})...` });
          // 指数退避等待
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }

        // 下载文件
        const response = await axios({
          method: 'GET',
          url: audioUrl,
          responseType: 'stream',
          timeout: 120000, // 120秒超时
        });

        const totalLength = parseInt(response.headers['content-length'], 10);
        let downloadedLength = 0;
        
        // 保存到临时文件
        const writer = fs.createWriteStream(tempPath);

        response.data.on('data', (chunk) => {
          downloadedLength += chunk.length;
          if (onProgress && totalLength) {
            const progress = Math.round((downloadedLength / totalLength) * 100);
            onProgress({ status: 'downloading', progress, downloadedLength, totalLength });
          }
        });

        await pipelineAsync(response.data, writer);
        
        // 下载完成后重命名
        // 再次检查目标文件是否被创建（极端并发情况）
        if (!fileExists(filePath)) {
          await fs.promises.rename(tempPath, filePath);
        } else {
          // 如果目标文件已存在，删除临时文件
          try { await fs.promises.unlink(tempPath); } catch (e) {}
        }
        
        if (onProgress) onProgress({ status: 'completed', progress: 100 });
        return; // 成功后退出循环
        
      } catch (error) {
        lastError = error;
        console.error(`下载尝试 ${attempt + 1} 失败 [${songName} - ${artist}]:`, error.message);
        
        // 清理临时文件以便下次重试
        if (fs.existsSync(tempPath)) {
          try { await fs.promises.unlink(tempPath); } catch (e) {}
        }

        if (attempt === retryCount) {
          if (onProgress) onProgress({ status: 'failed', error: lastError.message });
          throw lastError;
        }
      }
    }
  })();

  // 存入锁
  songDownloadLocks.set(filePath, downloadTask);

  try {
    await downloadTask;
  } finally {
    // 任务结束（无论成功失败），释放锁
    songDownloadLocks.delete(filePath);
  }
}

// 下载并保存音乐文件 (保留用于兼容，但建议使用 ensureSongCached)
async function downloadAndSaveSong(source, artist, album, songName, quality, audioUrl) {
  return ensureSongCached(source, artist, album, songName, quality, audioUrl);
}

// 下载并保存专辑封面
async function downloadAndSaveCover(source, artist, album, songName, coverUrl) {
  try {
    const filePath = getCoverStoragePath(source, artist, album, songName);
    const tempPath = `${filePath}.tmp`;
    
    // 如果文件已存在，直接返回路径
    if (fileExists(filePath)) {
      return filePath;
    }
    
    // 如果临时文件已存在，说明正在下载中
    if (fileExists(tempPath)) {
      return filePath;
    }
    
    // 下载文件
    const response = await axios({
      method: 'GET',
      url: coverUrl,
      responseType: 'stream',
      timeout: 120000, // 120秒超时
    });
    
    // 保存到临时文件
    const writer = fs.createWriteStream(tempPath);
    await pipelineAsync(response.data, writer);
    
    // 下载完成后重命名
    await fs.promises.rename(tempPath, filePath);
    
    return filePath;
  } catch (error) {
    console.error(`下载专辑封面失败 [${songName} - ${artist}]:`, error.message);
    const filePath = getCoverStoragePath(source, artist, album, songName);
    const tempPath = `${filePath}.tmp`;
    if (fs.existsSync(tempPath)) {
      try { await fs.promises.unlink(tempPath); } catch (e) {}
    }
    throw error;
  }
}

// 保存歌词文件（直接保存文本内容）
function saveLyrics(source, artist, album, songName, lyricsText) {
  try {
    const filePath = getLyricsStoragePath(source, artist, album, songName);
    
    // 如果文件已存在，直接返回路径
    if (fileExists(filePath)) {
      return filePath;
    }
    
    // 保存文件
    fs.writeFileSync(filePath, lyricsText, 'utf8');
    
    return filePath;
  } catch (error) {
    console.error(`保存歌词文件失败 [${songName} - ${artist}]:`, error.message);
    throw error;
  }
}

// 读取本地歌词文件
function readLocalLyrics(source, artist, album, songName) {
  try {
    const filePath = getLyricsStoragePath(source, artist, album, songName);
    if (fileExists(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return null;
  } catch (error) {
    console.error('读取本地歌词失败:', error.message);
    return null;
  }
}

// 获取本地音乐文件路径
function getLocalSongPath(source, artist, album, songName, quality) {
  const filePath = getSongStoragePath(source, artist, album, songName, quality);
  if (fileExists(filePath)) {
    return filePath;
  }
  return null;
}

// 获取本地封面路径
function getLocalCoverPath(source, artist, album, songName) {
  const filePath = getCoverStoragePath(source, artist, album, songName);
  if (fileExists(filePath)) {
    return filePath;
  }
  return null;
}

// 扫描本地库 (异步)
async function scanLibrary() {
  const library = [];
  if (!fs.existsSync(STORAGE_DIR)) return library;

  try {
    const platforms = await fs.promises.readdir(STORAGE_DIR);
    for (const platform of platforms) {
      const platformPath = path.join(STORAGE_DIR, platform);
      const stat = await fs.promises.stat(platformPath);
      if (!stat.isDirectory()) continue;

      const artists = await fs.promises.readdir(platformPath);
      for (const artist of artists) {
        const artistPath = path.join(platformPath, artist);
        const stat = await fs.promises.stat(artistPath);
        if (!stat.isDirectory()) continue;

        const albums = await fs.promises.readdir(artistPath);
        for (const album of albums) {
          const albumPath = path.join(artistPath, album);
          const stat = await fs.promises.stat(albumPath);
          if (!stat.isDirectory()) continue;

          const songs = await fs.promises.readdir(albumPath);
          for (const songDirName of songs) {
            const songPath = path.join(albumPath, songDirName);
            const stat = await fs.promises.stat(songPath);
            if (!stat.isDirectory()) continue;
            
            const files = await fs.promises.readdir(songPath);
            const safeSongName = sanitizeFileName(songDirName);
            
            // 优先查找匹配文件名的音频文件
            let songFile = files.find(f => f.startsWith(safeSongName) && (f.endsWith('.mp3') || f.endsWith('.flac')));
            
            // 如果没找到，放宽条件，查找任意音频文件
            if (!songFile) {
              songFile = files.find(f => f.endsWith('.mp3') || f.endsWith('.flac'));
            }
            
            if (songFile) {
              library.push({
                platform,
                artist,
                album,
                name: songDirName,
                id: `local_${platform}_${artist}_${album}_${songDirName}`,
                hasCover: files.includes(`${safeSongName}.jpg`),
                hasLyrics: files.includes(`${safeSongName}.lrc`),
                format: songFile.split('.').pop(),
                path: path.join(platform, artist, album, songDirName, songFile) // 相对路径
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('扫描本地库失败:', err.message);
  }
  return library;
}

// 流式代理并保存歌曲（边下边播）- 已废弃，仅保留流式代理功能
async function streamAndSaveSong(req, res, audioUrl, filePath) {
  if (!audioUrl) {
    console.error('流式代理失败: audioUrl 为空');
    return res.status(400).send('Audio URL is required');
  }

  // 1. 检查 Range 请求
  const range = req.headers.range;
  
  // 2. 请求上游音频流
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };
  if (range) headers['Range'] = range;
  
  try {
    const response = await axios({
      method: 'GET',
      url: audioUrl,
      responseType: 'stream',
      headers: headers,
      timeout: 30000, // 30秒连接超时
      // 允许 200 和 206 (Partial Content)
      validateStatus: status => (status >= 200 && status < 300) || status === 206
    });
    
    // 3. 设置响应头
    res.status(response.status);
    ['content-type', 'content-length', 'accept-ranges', 'content-range'].forEach(key => {
      if (response.headers[key]) {
        res.set(key, response.headers[key]);
      }
    });
    
    // 4. 管道传输给客户端
    const stream = response.data;
    
    // 监听客户端断开连接
    req.on('close', () => {
      if (stream && !stream.destroyed) {
        stream.destroy();
      }
    });

    stream.on('error', (err) => {
      console.error('上游流读取出错:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Upstream stream error');
      }
      stream.destroy();
    });

    stream.pipe(res);
    
    // 注意：不再在此处保存文件，而是由 ensureSongCached 在后台处理
    
  } catch (error) {
    console.error('流式代理请求出错:', error.message);
    if (!res.headersSent) {
      const status = error.response ? error.response.status : 500;
      res.status(status).send(error.message || 'Stream request error');
    }
  }
}

module.exports = {
  getSongStoragePath,
  getLyricsStoragePath,
  getCoverStoragePath,
  fileExists,
  downloadAndSaveSong,
  downloadAndSaveCover,
  saveLyrics,
  readLocalLyrics,
  getLocalSongPath,
  getLocalCoverPath,
  scanLibrary,
  streamAndSaveSong,
  ensureSongCached,
  STORAGE_DIR
};