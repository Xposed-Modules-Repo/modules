const fs = require('fs')
const path = require('path')

// Work around for caches on gh-pages
// https://github.com/gatsbyjs/gatsby/issues/15080#issuecomment-765338035
const publicPath = path.join(__dirname, 'public')
const publicCachePath = path.join(__dirname, 'public-cache')
if (fs.existsSync(publicCachePath)) {
  console.log(`[onPreBuild] Cache exists, renaming ${publicCachePath} to ${publicPath}`)
  if (fs.existsSync(publicPath)) {
    fs.rmdirSync(publicPath, { recursive: true })
  }
  fs.renameSync(publicCachePath, publicPath)
}
