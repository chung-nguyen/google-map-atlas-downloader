const fs = require('fs');
const jimp = require('jimp');
const axios = require('axios');
const path = require('path');
const asyncBatch = require('async-batch').default;

const { app, BrowserWindow, ipcMain, dialog } = require('electron')

const MAX_JOB_THREADS = 16;

var generateProgress = {
  processed: 0,
  total: 0
};

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true
    }
  })

  // and load the index.html of the app.
  win.loadFile('index.html')

  ipcMain.on('generateMap', function (event, data) {
    data.savePath = './map.jpg';
    dialog.showSaveDialog({
      filters: [
        { name: 'JPEG', extensions: ['jpg'] }
      ]
    })
      .then((result) => {
        if (result.canceled) {
          return;
        }

        data.savePath = result.filePath;
        return generateMap(data);
      })
      .then((result) => {
        event.sender.send('generateMapDone', result);
      })
      .catch((error) => {
        console.error(error);
        event.sender.send('generateMapFailed', error);
      });
  });

  ipcMain.on('queryGenerateProgress', function (event, data) {
    event.sender.send('replyGenerateProgress', generateProgress);
  });

  // Open the DevTools.
  // win.webContents.openDevTools()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

function generateMap(data) {
  // reset
  generateProgress.processed = 0;
  generateProgress.total = 0;

  var horzCount = data.size * 2;
  var vertCount = data.size * 2;

  // prepare jobs list
  var serverIndex = 0;
  var jobs = [];
  for (var i = 0; i < horzCount; ++i) {
    for (var j = 0; j < vertCount; ++j) {
      jobs.push({
        // index of the server to get the image (from 0 - 3)
        serverIndex: serverIndex,
        // layer type
        layer: data.layer,
        // zoom level
        zoom: data.zoom,
        // tile position of the map
        xtile: data.xtile + (i - Math.floor(horzCount / 2)),
        ytile: data.ytile + (j - Math.floor(vertCount / 2)),
        // the index on atlas
        indexX: i,
        indexY: j,
        // image position on atlas
        x: 0,
        y: 0
      });

      serverIndex = (serverIndex + 1) % 4;
    }
  }

  generateProgress.total = horzCount * vertCount;

  var tiles;

  // asynchronouly download tiles in batches
  return asyncBatch(jobs, downloadTileToJimp, MAX_JOB_THREADS)
    .then(function (result) {
      tiles = result;
      return createAllAtlas(tiles, data);
    });
}

function createAllAtlas(tiles, data) {
  const { maxAtlasSize } = data;

  const savePath = path.parse(data.savePath);

  var horzCount = data.size * 2;
  var vertCount = data.size * 2;

  var atlasWidth = 0;
  var atlasHeight = 0;

  // layout the tiles
  var x = 0;
  var y = 0;
  for (var i = 0; i < horzCount; ++i) {
    var maxTileWidth = 0;
    for (var j = 0; j < vertCount; ++j) {
      var tile = tiles.find((it) => (it.indexX === i && it.indexY === j));
      tile.x = x;
      tile.y = y;

      y += tile.height;
      maxTileWidth = Math.max(tile.width, maxTileWidth);
    }

    atlasHeight = Math.max(y, atlasHeight);

    y = 0;
    x += maxTileWidth;
  }

  atlasWidth = x;

  var atlasHorzCount = Math.ceil(atlasWidth / maxAtlasSize);
  var atlasVertCount = Math.ceil(atlasHeight / maxAtlasSize);

  var jobs = [];
  for (var i = 0; i < atlasHorzCount; ++i) {
    for (var j = 0; j < atlasVertCount; ++j) {
      var partX1 = i * maxAtlasSize;
      var partY1 = j * maxAtlasSize;
      var partX2 = partX1 + maxAtlasSize;
      var partY2 = partY1 + maxAtlasSize;

      var partialTiles = tiles.filter((it) => isTileInRegion(it, partX1, partY1, partX2, partY2));

      jobs.push({
        tiles: partialTiles,
        left: partX1,
        top: partY1,
        indexX: i,
        indexY: j,
        width: maxAtlasSize,
        height: maxAtlasSize,
        filePath: `${savePath.dir}/${savePath.name}-${i}-${j}${savePath.ext}`
      });
    }
  }

  return asyncBatch(jobs, createAtlas, 1);
}

function createAtlas(job) {
  var atlasImage;

  return jimp.create(job.width, job.height)
    .then(function (result) {
      atlasImage = result;
      return job.tiles.reduce(function (prev, r) {
        return prev.then(() => atlasImage.blit(r.image, r.x - job.left, r.y - job.top, 0, 0, r.width, r.height))
      }, Promise.resolve());
    })
    .then(function () {
      atlasImage.write(job.filePath)
    })
}

function isTileInRegion(tile, x1, y1, x2, y2) {
  return !(tile.x > x2 || tile.y > y2 || (tile.x + tile.width) < x1 || (tile.y + tile.height) < y1);
}

function downloadTileToJimp(job) {
  const { serverIndex, layer, zoom, xtile, ytile, indexX, indexY } = job;

  return axios({
    url: `http://mt${serverIndex}.google.com/vt/lyrs=${layer}&x=${xtile}&y=${ytile}&z=${zoom}`,
    method: 'get',
    responseType: 'arraybuffer'
  })
    .then(function (response) {
      return jimp.read(Buffer.from(response.data));
    })
    .then(function (image) {
      generateProgress.processed += 1;

      return {
        image: image,
        job: job,
        xtile: xtile,
        ytile: ytile,
        indexX: indexX,
        indexY: indexY,
        width: image.bitmap.width,
        height: image.bitmap.height
      };
    });
}
