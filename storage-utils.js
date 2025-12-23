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

// 下载并保存音乐文件
async function downloadAndSaveSong(source, artist, album, songName, quality, audioUrl) {
  try {
    const filePath = getSongStoragePath(source, artist, album, songName, quality);
    const tempPath = `${filePath}.tmp`;
    
    // 如果文件已存在，直接返回路径
    if (fileExists(filePath)) {
      return filePath;
    }
    
    // 如果临时文件已存在，说明正在下载中，直接返回（避免重复下载）
    if (fileExists(tempPath)) {
      console.log(`文件正在下载中: ${tempPath}`);
      return filePath;
    }
    
    // 下载文件
    const response = await axios({
      method: 'GET',
      url: audioUrl,
      responseType: 'stream',
      timeout: 120000, // 120秒超时
    });
    
    // 保存到临时文件
    const writer = fs.createWriteStream(tempPath);
    await pipelineAsync(response.data, writer);
    
    // 下载完成后重命名
    fs.renameSync(tempPath, filePath);
    
    return filePath;
  } catch (error) {
    console.error('下载音乐文件失败:', error.message);
    // 出错时清理临时文件
    const filePath = getSongStoragePath(source, artist, album, songName, quality);
    const tempPath = `${filePath}.tmp`;
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
    throw error;
  }
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
    fs.renameSync(tempPath, filePath);
    
    return filePath;
  } catch (error) {
    console.error('下载专辑封面失败:', error.message);
    const filePath = getCoverStoragePath(source, artist, album, songName);
    const tempPath = `${filePath}.tmp`;
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
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
    console.error('保存歌词文件失败:', error.message);
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

// 扫描本地库
function scanLibrary() {
  const library = [];
  if (!fs.existsSync(STORAGE_DIR)) return library;

  try {
    const platforms = fs.readdirSync(STORAGE_DIR);
    platforms.forEach(platform => {
      const platformPath = path.join(STORAGE_DIR, platform);
      if (!fs.statSync(platformPath).isDirectory()) return;

      const artists = fs.readdirSync(platformPath);
      artists.forEach(artist => {
        const artistPath = path.join(platformPath, artist);
        if (!fs.statSync(artistPath).isDirectory()) return;

        const albums = fs.readdirSync(artistPath);
        albums.forEach(album => {
          const albumPath = path.join(artistPath, album);
          if (!fs.statSync(albumPath).isDirectory()) return;

          const songs = fs.readdirSync(albumPath);
          songs.forEach(songDirName => {
            const songPath = path.join(albumPath, songDirName);
            if (!fs.statSync(songPath).isDirectory()) return;
            
            const files = fs.readdirSync(songPath);
            const safeSongName = sanitizeFileName(songDirName);
            const songFile = files.find(f => f.startsWith(safeSongName) && (f.endsWith('.mp3') || f.endsWith('.flac')));
            
            if (songFile) {
              library.push({
                platform,
                artist: artist, // 保持原始目录名，前端显示时可能需要处理
                album: album,
                name: songDirName,
                id: `local_${platform}_${artist}_${album}_${songDirName}`,
                hasCover: files.includes(`${safeSongName}.jpg`),
                hasLyrics: files.includes(`${safeSongName}.lrc`),
                format: songFile.split('.').pop(),
                path: path.join(platform, artist, album, songDirName, songFile) // 相对路径
              });
            }
          });
        });
      });
    });
  } catch (err) {
    console.error('扫描本地库失败:', err.message);
  }
  return library;
}

// 流式代理并保存歌曲（边下边播）
async function streamAndSaveSong(req, res, audioUrl, filePath) {
  // 1. 检查 Range 请求
  const range = req.headers.range;
  const isPartial = range && !range.startsWith('bytes=0-');
  
  // 2. 请求上游音频流
  const headers = {};
  if (range) headers['Range'] = range;
  
  try {
    const response = await axios({
      method: 'GET',
      url: audioUrl,
      responseType: 'stream',
      headers: headers,
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
    response.data.pipe(res);
    
    // 5. 保存到文件（仅当不是部分请求且响应成功时）
    // 如果是部分请求，保存的文件可能不完整，所以跳过保存
    if (!isPartial && response.status === 200 && filePath) {
      const tempPath = `${filePath}.tmp`;
      
      // 如果临时文件已存在，说明可能有其他请求正在下载，这里就不重复下载了
      // 但为了简单起见，我们这里还是尝试写入，或者可以加锁
      // 考虑到 Node.js 单线程特性，如果 createWriteStream 成功，通常没问题
      
      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        try {
          fs.renameSync(tempPath, filePath);
          console.log(`歌曲已流式保存: ${filePath}`);
        } catch (err) {
          console.error('重命名文件失败:', err.message);
        }
      });
      
      writer.on('error', (err) => {
        console.error('保存流出错:', err.message);
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (e) {}
        }
      });
    }
    
  } catch (error) {
    console.error('流式代理出错:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Stream error');
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
  STORAGE_DIR
};