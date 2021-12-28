const fs = require('fs')
const path = require('path')
const glob = require('glob')
const md5 = require('uuid')

// Work around for caches on gh-pages
// https://github.com/gatsbyjs/gatsby/issues/15080#issuecomment-765338035
const publicPath = path.join(__dirname, 'public')
const publicCachePath = path.join(__dirname, 'public-cache')
if (fs.existsSync(publicCachePath)) {
  fs.rmdirSync(publicCachePath, { recursive: true })
}
fs.cpSync(publicPath, publicCachePath, { recursive: true })
console.log(`[onPostBuild] Copied ${publicPath} to ${publicCachePath}`)
const hash = md5(Math.random().toString(36).substring(7))
const jsonFiles = glob.sync(`${publicPath}/page-data/**/page-data.json`)
console.log(`[onPostBuild] Renaming the following files to page-data.${hash}.json:`)
for (const file of jsonFiles) {
  console.log(file)
  const newFilename = file.replace('page-data.json', `page-data.${hash}.json`)
  fs.renameSync(file, newFilename)
}
const appShaFiles = glob.sync(`${publicPath}/**/app-+([^-]).js`)
const [appShaFile] = appShaFiles
const [appShaFilename] = appShaFile.split('/').slice(-1)
const appShaFilenameReg = new RegExp(appShaFilename, 'g')
const newAppShaFilename = `app-${hash}.js`
const newFilePath = appShaFile.replace(appShaFilename, newAppShaFilename)
console.log(`[onPostBuild] Renaming: ${appShaFilename} to ${newAppShaFilename}`)
fs.renameSync(appShaFile, newFilePath)
if (fs.existsSync(`${appShaFile}.map`)) {
  fs.renameSync(`${appShaFile}.map`, `${newFilePath}.map`)
}
if (fs.existsSync(`${appShaFile}.LICENSE.txt`)) {
  fs.renameSync(`${appShaFile}.LICENSE.txt`, `${newFilePath}.LICENSE.txt`)
}
const htmlJSAndJSONFiles = [
  `${newFilePath}.map`,
  ...glob.sync(`${publicPath}/**/*.{html,js,json}`)
]
console.log(
  `[onPostBuild] Replacing page-data.json, ${appShaFilename}, and ${appShaFilename}.map references in the following files:`
)
for (const file of htmlJSAndJSONFiles) {
  const stats = fs.statSync(file, 'utf8')
  if (!stats.isFile()) {
    continue
  }
  const content = fs.readFileSync(file, 'utf8')
  const result = content
    .replace(appShaFilenameReg, newAppShaFilename)
    .replace(/page-data.json/g, `page-data.${hash}.json`)
  if (result !== content) {
    console.log(file)
    fs.writeFileSync(file, result, 'utf8')
  }
}
