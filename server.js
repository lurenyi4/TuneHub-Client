const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const storageUtils = require('./storage-utils');
const historyUtils = require('./history-utils');
const playlistHistoryUtils = require('./playlist-history-utils');

// 下载任务追踪
const downloadTasks = new Map();

function updateDownloadTask(id, data) {
  const task = downloadTasks.get(id) || { id, startTime: Date.now() };
  downloadTasks.set(id, { ...task, ...data, lastUpdate: Date.now() });
  
  // 10分钟后清理已完成或失败的任务
  if (data.status === 'completed' || data.status === 'failed') {
    setTimeout(() => downloadTasks.delete(id), 10 * 60 * 1000);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = 'https://music-dl.sayqz.com';

// 中间件
app.use(cors());
// 增加请求体大小限制到 500MB（用于批量保存歌单）
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static('public'));
app.use('/storage', express.static(storageUtils.STORAGE_DIR));

// 获取下载任务列表
app.get('/api/download/tasks', (req, res) => {
  const tasks = Array.from(downloadTasks.values());
  res.json({
    code: 200,
    data: tasks
  });
});

// 获取本地库列表
app.get('/api/local/library', async (req, res) => {
  try {
    const library = await storageUtils.scanLibrary();
    res.json({
      code: 200,
      data: library
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

// API 代理路由
app.get('/api/proxy/info', async (req, res) => {
  try {
    const { source, id } = req.query;
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { source, id, type: 'info' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/url', async (req, res) => {
  try {
    const { source, id, br } = req.query;
    const quality = br || '320k';
    
    // 先获取歌曲信息（用于构建存储路径）
    let songInfo = null;
    try {
      const infoResponse = await axios.get(`${API_BASE_URL}/api/`, {
        params: { source, id, type: 'info' }
      });
      if (infoResponse.data && infoResponse.data.code === 200 && infoResponse.data.data) {
        songInfo = infoResponse.data.data;
      }
    } catch (err) {
      console.error('获取歌曲信息失败:', err.message);
    }
    
    // 如果获取到歌曲信息，检查本地缓存
    if (songInfo) {
      const localPath = storageUtils.getLocalSongPath(
        source, 
        songInfo.artist || '未知歌手', 
        songInfo.album || '未知专辑', 
        songInfo.name || '未知歌曲', 
        quality
      );
      if (localPath) {
        return res.sendFile(localPath);
      }
    }
    
    // 本地没有缓存，从API获取
    const params = { source, id, type: 'url' };
    if (br) params.br = br;
    
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    if (response.status === 302 || response.status === 301) {
      const location = response.headers.location;
      const sourceSwitch = response.headers['x-source-switch'];
      
      if (sourceSwitch) {
        res.set('X-Source-Switch', sourceSwitch);
      }
      
      // 触发后台下载
      if (songInfo) {
        const taskId = `${source}_${id}_${quality}`;
        updateDownloadTask(taskId, { 
          name: songInfo.name, 
          artist: songInfo.artist, 
          status: 'pending', 
          progress: 0 
        });
        
        storageUtils.ensureSongCached(
          source, 
          songInfo.artist || '未知歌手', 
          songInfo.album || '未知专辑', 
          songInfo.name || '未知歌曲', 
          quality,
          location,
          (progressData) => updateDownloadTask(taskId, progressData)
        ).catch(err => {
          console.error('后台下载触发失败:', err.message);
          updateDownloadTask(taskId, { status: 'failed', error: err.message });
        });
      }
      
      // 流式代理
      await storageUtils.streamAndSaveSong(req, res, location, null);
    } else {
      res.json(response.data);
    }
  } catch (error) {
    if (error.response && (error.response.status === 302 || error.response.status === 301)) {
      const location = error.response.headers.location;
      const sourceSwitch = error.response.headers['x-source-switch'];
      const quality = req.query.br || '320k';
      
      if (sourceSwitch) {
        res.set('X-Source-Switch', sourceSwitch);
      }
      
      // 尝试获取歌曲信息并触发后台下载
      try {
        const infoResponse = await axios.get(`${API_BASE_URL}/api/`, {
          params: { source: req.query.source, id: req.query.id, type: 'info' }
        });
        if (infoResponse.data && infoResponse.data.code === 200 && infoResponse.data.data) {
          const songInfo = infoResponse.data.data;
          const taskId = `${req.query.source}_${req.query.id}_${quality}`;
          updateDownloadTask(taskId, { 
            name: songInfo.name, 
            artist: songInfo.artist, 
            status: 'pending', 
            progress: 0 
          });

          storageUtils.ensureSongCached(
            req.query.source, 
            songInfo.artist || '未知歌手', 
            songInfo.album || '未知专辑', 
            songInfo.name || '未知歌曲', 
            quality,
            location,
            (progressData) => updateDownloadTask(taskId, progressData)
          ).catch(err => {
            console.error('后台下载触发失败:', err.message);
            updateDownloadTask(taskId, { status: 'failed', error: err.message });
          });
        }
      } catch (err) {
        console.error('获取歌曲信息失败:', err.message);
      }
      
      await storageUtils.streamAndSaveSong(req, res, location, null);
    } else {
      res.status(500).json({ 
        code: 500, 
        message: error.message,
        data: null 
      });
    }
  }
});

app.get('/api/proxy/pic', async (req, res) => {
  try {
    const { source, id } = req.query;
    
    // 先获取歌曲信息（用于构建存储路径和检查本地缓存）
    let songInfo = null;
    try {
      const infoResponse = await axios.get(`${API_BASE_URL}/api/`, {
        params: { source, id, type: 'info' }
      });
      if (infoResponse.data && infoResponse.data.code === 200 && infoResponse.data.data) {
        songInfo = infoResponse.data.data;
      }
    } catch (err) {
      console.error('获取歌曲信息失败:', err.message);
    }
    
    // 如果获取到歌曲信息，检查本地缓存
    if (songInfo) {
      const localCover = storageUtils.getLocalCoverPath(
        source, 
        songInfo.artist || '未知歌手', 
        songInfo.album || '未知专辑', 
        songInfo.name || '未知歌曲'
      );
      if (localCover) {
        return res.sendFile(localCover);
      }
    }
    
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { source, id, type: 'pic' },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    if (response.status === 302 || response.status === 301) {
      const location = response.headers.location;
      
      // 异步下载并保存封面（不阻塞响应）
      if (songInfo && location) {
        storageUtils.downloadAndSaveCover(
          source, 
          songInfo.artist || '未知歌手', 
          songInfo.album || '未知专辑', 
          songInfo.name || '未知歌曲', 
          location
        ).then(savedPath => {
        }).catch(err => {
          console.error('保存专辑封面失败:', err.message);
        });
      }
      
      return res.redirect(location);
    } else if (response.data && response.data.code === 200 && response.data.data) {
      // 如果 API 直接返回了封面 URL 而不是重定向
      const location = response.data.data;
      if (songInfo && location) {
        storageUtils.downloadAndSaveCover(
          source, 
          songInfo.artist || '未知歌手', 
          songInfo.album || '未知专辑', 
          songInfo.name || '未知歌曲', 
          location
        ).catch(err => console.error('保存专辑封面失败:', err.message));
      }
      return res.redirect(location);
    } else {
      res.json(response.data);
    }
  } catch (error) {
    if (error.response && (error.response.status === 302 || error.response.status === 301)) {
      const location = error.response.headers.location;
      
      // 尝试获取歌曲信息并保存封面
      try {
        const infoResponse = await axios.get(`${API_BASE_URL}/api/`, {
          params: { source: req.query.source, id: req.query.id, type: 'info' }
        });
        if (infoResponse.data && infoResponse.data.code === 200 && infoResponse.data.data) {
          const songInfo = infoResponse.data.data;
          storageUtils.downloadAndSaveCover(
            req.query.source, 
            songInfo.artist || '未知歌手', 
            songInfo.album || '未知专辑', 
            songInfo.name || '未知歌曲', 
            location
          ).then(savedPath => {
          }).catch(err => {
            console.error('保存专辑封面失败:', err.message);
          });
        }
      } catch (err) {
        console.error('获取歌曲信息失败:', err.message);
      }
      
      res.redirect(location);
    } else {
      res.status(500).json({ 
        code: 500, 
        message: error.message,
        data: null 
      });
    }
  }
});

app.get('/api/proxy/lrc', async (req, res) => {
  try {
    const { source, id } = req.query;
    
    // 先获取歌曲信息（用于构建存储路径）
    let songInfo = null;
    try {
      const infoResponse = await axios.get(`${API_BASE_URL}/api/`, {
        params: { source, id, type: 'info' }
      });
      if (infoResponse.data && infoResponse.data.code === 200 && infoResponse.data.data) {
        songInfo = infoResponse.data.data;
      }
    } catch (err) {
      console.error('获取歌曲信息失败:', err.message);
    }
    
    // 如果获取到歌曲信息，检查本地缓存
    if (songInfo) {
      const localLyrics = storageUtils.readLocalLyrics(
        source, 
        songInfo.artist || '未知歌手', 
        songInfo.album || '未知专辑', 
        songInfo.name || '未知歌曲'
      );
      if (localLyrics) {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        return res.send(localLyrics);
      }
    }
    
    // 本地没有缓存，从API获取
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { source, id, type: 'lrc' },
      responseType: 'text'
    });
    
    const lyricsText = response.data;
    
    // 异步保存歌词（不阻塞响应）
    if (songInfo) {
      try {
        storageUtils.saveLyrics(
          source, 
          songInfo.artist || '未知歌手', 
          songInfo.album || '未知专辑', 
          songInfo.name || '未知歌曲', 
          lyricsText
        );
      } catch (err) {
        console.error('保存歌词文件失败:', err.message);
      }
    }
    
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(lyricsText);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/search', async (req, res) => {
  try {
    const { source, keyword, limit } = req.query;
    const params = { source, type: 'search', keyword };
    if (limit) params.limit = limit;
    
    const response = await axios.get(`${API_BASE_URL}/api/`, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/aggregateSearch', async (req, res) => {
  try {
    const { keyword } = req.query;
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { type: 'aggregateSearch', keyword }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/playlist', async (req, res) => {
  try {
    const { source, id } = req.query;
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { source, id, type: 'playlist' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/toplists', async (req, res) => {
  try {
    const { source } = req.query;
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { source, type: 'toplists' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/toplist', async (req, res) => {
  try {
    const { source, id } = req.query;
    const response = await axios.get(`${API_BASE_URL}/api/`, {
      params: { source, id, type: 'toplist' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/status', async (req, res) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/status`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/health', async (req, res) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/health`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/stats', async (req, res) => {
  try {
    const { period, groupBy } = req.query;
    const params = {};
    if (period) params.period = period;
    if (groupBy) params.groupBy = groupBy;
    
    const response = await axios.get(`${API_BASE_URL}/stats`, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/stats/summary', async (req, res) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/stats/summary`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/stats/platforms', async (req, res) => {
  try {
    const { period } = req.query;
    const params = period ? { period } : {};
    const response = await axios.get(`${API_BASE_URL}/stats/platforms`, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/stats/qps', async (req, res) => {
  try {
    const { period } = req.query;
    const params = period ? { period } : {};
    const response = await axios.get(`${API_BASE_URL}/stats/qps`, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/stats/trends', async (req, res) => {
  try {
    const { period } = req.query;
    const params = period ? { period } : {};
    const response = await axios.get(`${API_BASE_URL}/stats/trends`, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

app.get('/api/proxy/stats/types', async (req, res) => {
  try {
    const { period } = req.query;
    const params = period ? { period } : {};
    const response = await axios.get(`${API_BASE_URL}/stats/types`, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ 
      code: 500, 
      message: error.message,
      data: null 
    });
  }
});

// 注意：本地文件服务接口已移除，因为新的存储路径结构基于歌曲信息（歌手/专辑/歌曲名）
// 文件会通过 /api/proxy/url、/api/proxy/lrc、/api/proxy/pic 等接口自动使用缓存

// 获取存储统计信息
app.get('/api/storage/stats', async (req, res) => {
  try {
    const fs = require('fs');
    const storageDir = storageUtils.STORAGE_DIR;
    
    if (!fs.existsSync(storageDir)) {
      return res.json({
        code: 200,
        data: {
          totalSongs: 0,
          totalLyrics: 0,
          totalSize: 0,
          platforms: {}
        }
      });
    }
    
    let totalSongs = 0;
    let totalLyrics = 0;
    let totalSize = 0;
    const platforms = {};
    
    function getDirSize(dirPath) {
      let size = 0;
      try {
        const files = fs.readdirSync(dirPath);
        files.forEach(file => {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            size += getDirSize(filePath);
          } else {
            size += stats.size;
          }
        });
      } catch (err) {
        console.error('读取目录失败:', err.message);
      }
      return size;
    }
    
    function scanDirectory(dir) {
      const platforms = fs.readdirSync(dir);
      platforms.forEach(platform => {
        const platformPath = path.join(dir, platform);
        if (fs.statSync(platformPath).isDirectory()) {
          const songs = fs.readdirSync(platformPath);
          let platformSongs = 0;
          let platformLyrics = 0;
          let platformSize = 0;
          
          songs.forEach(songId => {
            const songPath = path.join(platformPath, songId);
            if (fs.statSync(songPath).isDirectory()) {
              const files = fs.readdirSync(songPath);
              let hasSong = false;
              let hasLyrics = false;
              
              files.forEach(file => {
                const filePath = path.join(songPath, file);
                const stats = fs.statSync(filePath);
                platformSize += stats.size;
                
                const safeSongName = storageUtils.sanitizeFileName(songId);
                if (file === `${safeSongName}.lrc`) {
                  hasLyrics = true;
                  totalLyrics++;
                } else if (file.startsWith(safeSongName) && (file.endsWith('.mp3') || file.endsWith('.flac'))) {
                  hasSong = true;
                }
              });
              
              if (hasSong) {
                platformSongs++;
                totalSongs++;
              }
              if (hasLyrics) {
                platformLyrics++;
              }
            }
          });
          
          platforms[platform] = {
            songs: platformSongs,
            lyrics: platformLyrics,
            size: platformSize
          };
        }
      });
    }
    
    scanDirectory(storageDir);
    totalSize = getDirSize(storageDir);
    
    res.json({
      code: 200,
      data: {
        totalSongs,
        totalLyrics,
        totalSize,
        platforms
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

// 根路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 批量保存歌单歌曲
app.post('/api/playlist/save-all', async (req, res) => {
  try {
    // 检查请求体
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体为空',
        data: null
      });
    }
    
    const { source, songs, quality = 'flac24bit' } = req.body;
    
    if (!source || !songs || !Array.isArray(songs) || songs.length === 0) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数',
        data: null
      });
    }
    
    // 限制最大歌曲数量，避免请求过大
    if (songs.length > 5000) {
      return res.status(400).json({
        code: 400,
        message: '歌曲数量过多，最多支持500首',
        data: null
      });
    }
    
    const results = {
      total: songs.length,
      success: 0,
      failed: 0,
      details: []
    };

    // 预注册所有任务，确保前端可见
    songs.forEach(song => {
      const taskId = `${source}_${song.id}_${quality}`;
      if (!downloadTasks.has(taskId)) {
        updateDownloadTask(taskId, {
          name: song.name || '未知歌曲',
          artist: song.artist || '未知歌手',
          status: 'pending',
          progress: 0
        });
      }
    });
    
    // 批量处理歌曲（限制并发数）
    const BATCH_SIZE = 5;
    for (let i = 0; i < songs.length; i += BATCH_SIZE) {
      const batch = songs.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (song) => {
        try {
          // 获取歌曲信息
          const infoResponse = await axios.get(`${API_BASE_URL}/api/`, {
            params: { source, id: song.id, type: 'info' }
          });
          
          if (infoResponse.data && infoResponse.data.code === 200 && infoResponse.data.data) {
            const songInfo = infoResponse.data.data;
            const artist = songInfo.artist || '未知歌手';
            const album = songInfo.album || '未知专辑';
            const songName = songInfo.name || song.name || '未知歌曲';
            
            // 检查是否已存在
            const localPath = storageUtils.getLocalSongPath(source, artist, album, songName, quality);
            if (localPath) {
              results.success++;
              results.details.push({ id: song.id, name: songName, status: '已存在' });
              return;
            }
            
            // 下载音乐文件
            const urlResponse = await axios.get(`${API_BASE_URL}/api/`, {
              params: { source, id: song.id, type: 'url', br: quality },
              maxRedirects: 0,
              validateStatus: (status) => status >= 200 && status < 400
            });
            
            if (urlResponse.status === 302 || urlResponse.status === 301) {
              const audioUrl = urlResponse.headers.location;
              const taskId = `${source}_${song.id}_${quality}`;
              updateDownloadTask(taskId, { 
                name: songName, 
                artist: artist, 
                status: 'pending', 
                progress: 0 
              });

              await storageUtils.downloadAndSaveSong(
                source, 
                artist, 
                album, 
                songName, 
                quality, 
                audioUrl,
                (progressData) => updateDownloadTask(taskId, progressData)
              );
            }
            
            // 下载歌词
            try {
              const lrcResponse = await axios.get(`${API_BASE_URL}/api/`, {
                params: { source, id: song.id, type: 'lrc' },
                responseType: 'text'
              });
              if (lrcResponse.data) {
                storageUtils.saveLyrics(source, artist, album, songName, lrcResponse.data);
              }
            } catch (err) {
              console.error(`保存歌词失败 ${songName}:`, err.message);
            }
            
            // 下载封面
            if (songInfo.pic) {
              try {
                const picResponse = await axios.get(`${API_BASE_URL}/api/`, {
                  params: { source, id: song.id, type: 'pic' },
                  maxRedirects: 0,
                  validateStatus: (status) => status >= 200 && status < 400
                });
                if (picResponse.status === 302 || picResponse.status === 301) {
                  const coverUrl = picResponse.headers.location;
                  await storageUtils.downloadAndSaveCover(source, artist, album, songName, coverUrl);
                }
              } catch (err) {
                console.error(`保存封面失败 ${songName}:`, err.message);
              }
            }
            
            results.success++;
            results.details.push({ id: song.id, name: songName, status: '成功' });
          } else {
            throw new Error('获取歌曲信息失败');
          }
        } catch (error) {
          results.failed++;
          results.details.push({ 
            id: song.id, 
            name: song.name || '未知', 
            status: '失败', 
            error: error.message 
          });
        }
      }));
    }
    
    res.json({
      code: 200,
      message: `保存完成：成功 ${results.success}，失败 ${results.failed}`,
      data: results
    });
  } catch (error) {
    console.error('批量保存歌单失败:', error);
    res.status(500).json({
      code: 500,
      message: error.message || '服务器错误',
      data: null
    });
  }
});

// 播放历史 API
app.get('/api/history', (req, res) => {
  try {
    const history = historyUtils.getPlayHistory();
    res.json({
      code: 200,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

app.post('/api/history', express.json(), (req, res) => {
  try {
    const { platform, id, name, artist } = req.body;
    if (!platform || !id) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数',
        data: null
      });
    }
    
    const success = historyUtils.addToHistory(platform, id, name || '', artist || '');
    if (success) {
      res.json({
        code: 200,
        message: '添加成功',
        data: null
      });
    } else {
      res.status(500).json({
        code: 500,
        message: '添加失败',
        data: null
      });
    }
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

app.delete('/api/history', (req, res) => {
  try {
    const { platform, id } = req.query;
    
    if (platform && id) {
      // 删除单条记录
      const success = historyUtils.removeHistoryItem(platform, id);
      if (success) {
        res.json({
          code: 200,
          message: '删除成功',
          data: null
        });
      } else {
        res.status(500).json({
          code: 500,
          message: '删除失败',
          data: null
        });
      }
    } else {
      // 清空所有记录
      const success = historyUtils.clearPlayHistory();
      if (success) {
        res.json({
          code: 200,
          message: '清空成功',
          data: null
        });
      } else {
        res.status(500).json({
          code: 500,
          message: '清空失败',
          data: null
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

// 歌单历史 API
app.get('/api/playlist-history', (req, res) => {
  try {
    const history = playlistHistoryUtils.getPlaylistHistory();
    res.json({
      code: 200,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

app.post('/api/playlist-history', express.json(), (req, res) => {
  try {
    const { platform, id, name, author } = req.body;
    if (!platform || !id) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数',
        data: null
      });
    }
    
    const success = playlistHistoryUtils.addToPlaylistHistory(platform, id, name || '', author || '');
    if (success) {
      res.json({
        code: 200,
        message: '添加成功',
        data: null
      });
    } else {
      res.status(500).json({
        code: 500,
        message: '添加失败',
        data: null
      });
    }
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

app.delete('/api/playlist-history', (req, res) => {
  try {
    const { platform, id } = req.query;
    
    if (platform && id) {
      // 删除单条记录
      const success = playlistHistoryUtils.removePlaylistHistoryItem(platform, id);
      if (success) {
        res.json({
          code: 200,
          message: '删除成功',
          data: null
        });
      } else {
        res.status(500).json({
          code: 500,
          message: '删除失败',
          data: null
        });
      }
    } else {
      // 清空所有记录
      const success = playlistHistoryUtils.clearPlaylistHistory();
      if (success) {
        res.json({
          code: 200,
          message: '清空成功',
          data: null
        });
      } else {
        res.status(500).json({
          code: 500,
          message: '清空失败',
          data: null
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
      data: null
    });
  }
});

// 错误处理中间件（放在最后）
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    // JSON 解析错误
    return res.status(400).json({
      code: 400,
      message: 'JSON 格式错误: ' + error.message,
      data: null
    });
  }
  
  if (error.type === 'entity.too.large') {
    // 请求体过大
    return res.status(413).json({
      code: 413,
      message: '请求体过大，请减少歌曲数量或分批保存',
      data: null
    });
  }
  
  console.error('未处理的错误:', error);
  res.status(500).json({
    code: 500,
    message: error.message || '服务器错误',
    data: null
  });
});

app.listen(PORT, () => {
});