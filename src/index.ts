import { env } from "node:process"
import { setFailed, info, warning, startGroup, endGroup } from "@actions/core"
import { HttpClient } from "@actions/http-client"
import { inflateRawSync } from "node:zlib"
import { getOctokit } from "@actions/github"
import { ApkError, CD, EOCD, LFH } from "./pkzip.js"
import { AndroidManifest } from "./axml.js"
import { RequestError } from "@octokit/request-error"

const httpClient = new HttpClient(
  "XposedBot/1.0 (+https://github.com/Xposed-Modules-Repo)",
  [],
  {
    socketTimeout: 15 * 1000,
    maxRedirects: 3,
    allowRetries: true,
    maxRetries: 3,
  },
)

async function httpHead(requestUrl: string) {
  const response = await httpClient.head(requestUrl)
  if (response.message.statusCode != 200) {
    throw Error(
      `http error: ${response.message.statusCode} ${await response.readBody()}`,
    )
  }
  return response.message.headers
}

async function httpGetRange(requestUrl: string, from: number, to: number) {
  const response = await httpClient.get(requestUrl, {
    range: `bytes=${from}-${to}`,
  })
  const statusCode = response.message.statusCode
  if (statusCode && !(statusCode >= 200 && statusCode < 300)) {
    throw Error(
      `http error: ${response.message.statusCode} ${await response.readBody()}`,
    )
  }
  if (response.readBodyBuffer === undefined)
    throw Error("readBodyBuffer is undefined")
  return Buffer.from(await response.readBodyBuffer())
}

async function main() {
  const orgRepo = env.REPO
  const release = env.RELEASE
  const apkUrl = env.APK
  let tagName = env.TAG
  const bearerToken = env.TAG_TOKEN

  if (orgRepo === undefined) {
    setFailed("REPO env is missing")
    return
  }
  const [owner, repo] = orgRepo.split("/")
  if (owner === undefined || repo === undefined) {
    setFailed("owner or repo is missing")
    return
  }
  if (release === undefined) {
    setFailed("RELEASE env is missing")
    return
  }
  const releaseId = parseInt(release)
  if (apkUrl === undefined) {
    setFailed("APK env is missing")
    return
  }
  if (tagName === undefined) {
    setFailed("TAG env is missing")
    return
  }
  if (bearerToken === undefined) {
    setFailed("TAG_TOKEN env is missing")
    return
  }

  const octokit = getOctokit(bearerToken)
  const setDraft = async () => {
    await octokit.rest.repos.updateRelease({
      owner,
      repo,
      release_id: releaseId,
      draft: true,
    })
  }
  const setReleaseTag = async (newTagName: string) => {
    await octokit.rest.repos.updateRelease({
      owner,
      repo,
      release_id: releaseId,
      tag_name: newTagName,
    })
  }
  const createEmptyCommit = async (newTagName: string) => {
    const { data: orphanCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: newTagName,
      // https://github.com/git/git/blob/master/t/oid-info/hash-info
      tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      parents: [],
      author: {
        name: "github-actions[bot]",
        email: "41898282+github-actions[bot]@users.noreply.github.com",
      },
    })

    try {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/tags/${newTagName}`,
        sha: orphanCommit.sha,
      })
    } catch(e) {
      // if (e instanceof RequestError && e.status === 409) {
      //   await octokit.rest.git.updateRef({
      //     owner,
      //     repo,
      //     ref: `refs/tags/${newTagName}`,
      //     sha: orphanCommit.sha,
      //     force: true,
      //   })
      // }
      // throw e
      if (e instanceof Error || typeof e === "string") {
        warning(e)
      }
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `refs/tags/${newTagName}`,
        sha: orphanCommit.sha,
        force: true,
      })
    }
  }

  const head = await httpHead(apkUrl)
  const contentType = head["content-type"]
  const contentLength = head["content-length"]
  if (contentType === undefined || contentLength === undefined) {
    setFailed("content-type or content-length is missing")
    await setDraft()
    return
  }
  const totalSize = parseInt(contentLength)
  if (totalSize < EOCD.HEADER_SIZE) {
    setFailed("this is not a valid APK file")
    await setDraft()
    return
  }
  let eocd: EOCD | undefined
  try {
    eocd = new EOCD(
      await httpGetRange(apkUrl, totalSize - EOCD.HEADER_SIZE, totalSize),
    )
  } catch (e) {
    if (e instanceof ApkError) {
      const data = await httpGetRange(
        apkUrl,
        Math.max(totalSize - EOCD.HEADER_SIZE - 65535, 0),
        totalSize,
      )
      let eocdOffset = totalSize - EOCD.HEADER_SIZE
      while (
        eocdOffset > 0 &&
        data.readUInt32BE(eocdOffset) !== EOCD.SIGNATURE
      ) {
        eocdOffset -= 1
      }
      if (eocdOffset <= 0) {
        setFailed(new ApkError("EOCD is not found"))
        await setDraft()
        return
      }
      eocd = new EOCD(data.subarray(eocdOffset, totalSize))
    } else if (e instanceof Error || typeof e === "string") {
      setFailed(e)
      await setDraft()
      return
    }
  }
  if (eocd === undefined) {
    setFailed(new ApkError("EOCD is not found"))
    await setDraft()
    return
  }

  const offCd = totalSize - EOCD.HEADER_SIZE - eocd.cdSize
  const bufCds = await httpGetRange(apkUrl, offCd, offCd + eocd.cdSize)

  let androidManifest: AndroidManifest | undefined
  let isXposed: boolean = false
  let isLibxposed: boolean = false
  let isLibxposedEntryExists: boolean = false
  let moduleProp: string = ""
  let isLibxposedVersionDefined: boolean = false

  let offCur = 0
  for (let i = 0; i < eocd.entries; i++) {
    const cd = new CD(bufCds, offCur)
    if (cd.filename === "AndroidManifest.xml") {
      const lfh = new LFH(
        await httpGetRange(
          apkUrl,
          cd.fileOffset,
          cd.fileOffset + LFH.HEADER_SIZE,
        ),
        cd,
      )
      const bufDeflate = Buffer.from(
        await httpGetRange(
          apkUrl,
          cd.fileOffset + lfh.size(),
          cd.fileOffset + lfh.size() + lfh.compSize,
        ),
      )

      androidManifest = new AndroidManifest(
        Buffer.from(inflateRawSync(bufDeflate)),
      )
    }

    if (cd.filename === "assets/xposed_init") {
      isXposed = true
    }
    if (cd.filename === "META-INF/xposed/module.prop") {
      isLibxposed = true
      const lfh = new LFH(
        await httpGetRange(
          apkUrl,
          cd.fileOffset,
          cd.fileOffset + LFH.HEADER_SIZE,
        ),
      )
      const bufDeflate = Buffer.from(
        await httpGetRange(
          apkUrl,
          cd.fileOffset + lfh.size(),
          cd.fileOffset + lfh.size() + lfh.compSize,
        ),
      )
      moduleProp = Buffer.from(inflateRawSync(bufDeflate)).toString().trim()
      if (
        moduleProp.includes("minApiVersion=") &&
        moduleProp.includes("targetApiVersion=")
      ) {
        isLibxposedVersionDefined = true
      }
    }
    if (
      cd.filename === "META-INF/xposed/java_init.list" ||
      cd.filename === "META-INF/xposed/native_init.list"
    ) {
      isLibxposedEntryExists = true
    }

    offCur += cd.size()
  }

  if (androidManifest === undefined) {
    setFailed(new ApkError("AndroidManifests.xml is not found or not valid"))
    await setDraft()
    return
  }

  info(`package: ${androidManifest.package}`)
  info(`versionCode: ${androidManifest.versionCode}`)
  info(`versionname: ${androidManifest.versionName}`)

  startGroup("details")

  if (isXposed && androidManifest.isXposed) {
    info(`xposedminversion: ${androidManifest.xposedMinVersion}`)
    if (androidManifest.isNewSXP) {
      warning(
        `this module might be using the deprecated New XSharedPreferences API`,
      )
    }
  } else if (
    isLibxposed &&
    isLibxposedEntryExists &&
    isLibxposedVersionDefined
  ) {
    info(moduleProp)
  } else {
    setFailed("this is not a valid Xposed module")
    await setDraft()
    endGroup()
    return
  }

  endGroup()

  const newTagName = `${androidManifest.versionCode}-${androidManifest.versionName}`
  if (tagName === newTagName) return
  try {
    await createEmptyCommit(newTagName)
  } catch (e) {
    if (e instanceof Error || typeof e === "string") {
      setFailed(e)
    }
    await setDraft()
    return
  }

  try {
    await setReleaseTag(newTagName)
  } catch (e) {
    if (e instanceof Error || typeof e === "string") {
      setFailed(e)
    }
    return
  }
}

main()
