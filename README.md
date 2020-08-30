# Google Map Atlas Downloader
A simple tool to download map tiles from Google Map and stitch together into atlases to be used in realtime applications like games, archvizs. Developed with Node JS and Electron.

# Feature
+ Download map tiles from Google Map and stitch them together.
+ Divide atlases into small parts if needed (giant images need huge memory to process).

# Build
Run `npm start` to start development build.

To build distributions, just follow Electron instructions:
https://www.electronjs.org/docs/tutorial/application-distribution

# Caveats
+ I did not have time to polish this so the UI and code structure is under a mess.
+ Map tiles download should be cached but it is not.
+ Map tiles contain Google Map copyright watermarks.
