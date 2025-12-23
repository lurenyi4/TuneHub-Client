const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'storage', 'playlist_history.json');
const MAX_HISTORY = 100;

// 确保历史文件存在
function ensureHistoryFile() {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

// 读取歌单历史
function getPlaylistHistory() {
  try {
    ensureHistoryFile();
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('读取歌单历史失败:', error.message);
    return [];
  }
}

// 添加歌单历史
function addToPlaylistHistory(platform, id, name, author) {
  try {
    ensureHistoryFile();
    let history = getPlaylistHistory();
    
    // 移除重复项（如果存在）
    history = history.filter(item => !(item.platform === platform && item.id === id));
    
    // 添加到开头
    history.unshift({
      platform,
      id,
      name,
      author,
      timestamp: Date.now()
    });
    
    // 限制历史记录数量
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }
    
    // 保存到文件
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存歌单历史失败:', error.message);
    return false;
  }
}

// 清空歌单历史
function clearPlaylistHistory() {
  try {
    ensureHistoryFile();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('清空歌单历史失败:', error.message);
    return false;
  }
}

// 删除单条歌单历史记录
function removePlaylistHistoryItem(platform, id) {
  try {
    ensureHistoryFile();
    let history = getPlaylistHistory();
    history = history.filter(item => !(item.platform === platform && item.id === id));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('删除歌单历史记录失败:', error.message);
    return false;
  }
}

module.exports = {
  getPlaylistHistory,
  addToPlaylistHistory,
  clearPlaylistHistory,
  removePlaylistHistoryItem
};