const storageUtils = require('../storage-utils');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { EventEmitter } = require('events');

jest.mock('fs', () => {
  return {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(),
    statSync: jest.fn(),
    promises: {
      readdir: jest.fn(),
      stat: jest.fn(),
      mkdir: jest.fn(),
      rename: jest.fn(),
      unlink: jest.fn(),
    },
    createWriteStream: jest.fn(),
    renameSync: jest.fn(),
    unlinkSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

jest.mock('axios');

jest.mock('stream', () => {
  const originalStream = jest.requireActual('stream');
  return {
    ...originalStream,
    pipeline: jest.fn((source, dest, cb) => {
      cb(null);
    })
  };
});

describe('storage-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scanLibrary', () => {
    it('should scan library asynchronously', async () => {
      // Setup mock fs
      fs.existsSync.mockReturnValue(true);
      
      // Mock readdir for platforms
      fs.promises.readdir
        .mockResolvedValueOnce(['netease']) // platforms
        .mockResolvedValueOnce(['Artist1']) // artists
        .mockResolvedValueOnce(['Album1']) // albums
        .mockResolvedValueOnce(['Song1']) // songs
        .mockResolvedValueOnce(['Song1.mp3', 'Song1.jpg']); // files in song dir

      // Mock stat to return directory or file
      fs.promises.stat.mockImplementation(async (p) => {
        if (p.endsWith('.mp3') || p.endsWith('.jpg')) {
            return { isDirectory: () => false, size: 1024 };
        }
        return { isDirectory: () => true };
      });

      const library = await storageUtils.scanLibrary();
      
      expect(library).toHaveLength(1);
      expect(library[0]).toEqual(expect.objectContaining({
        platform: 'netease',
        artist: 'Artist1',
        album: 'Album1',
        name: 'Song1',
        format: 'mp3',
        hasCover: true
      }));
    });
  });

  describe('ensureSongCached', () => {
    it('should download song if not exists', async () => {
      const source = 'netease';
      const artist = 'Artist1';
      const album = 'Album1';
      const songName = 'Song1';
      const quality = '320k';
      const audioUrl = 'http://example.com/song.mp3';

      // Mock file not exists
      fs.existsSync.mockReturnValue(false);
      
      // Mock axios stream
      const mockStream = new EventEmitter();
      mockStream.pipe = jest.fn();
      axios.mockResolvedValue({
        data: mockStream
      });

      // Mock write stream
      const mockWriter = new EventEmitter();
      fs.createWriteStream.mockReturnValue(mockWriter);

      // Start download
      const downloadPromise = storageUtils.ensureSongCached(source, artist, album, songName, quality, audioUrl);
      
      // Simulate stream events
      setTimeout(() => {
          mockWriter.emit('finish');
      }, 10);

      await downloadPromise;

      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        url: audioUrl,
        responseType: 'stream'
      }));
      expect(fs.createWriteStream).toHaveBeenCalled();
      expect(fs.promises.rename).toHaveBeenCalled();
    });

    it('should not download if already exists', async () => {
      fs.existsSync.mockReturnValue(true);
      
      await storageUtils.ensureSongCached('netease', 'A', 'B', 'C', '320k', 'http://url');
      
      expect(axios).not.toHaveBeenCalled();
    });
  });
});