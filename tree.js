#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { execSync } = require('child_process')

// 获取所有已挂载的硬盘
function getVolumes() {
  try {
    const output = execSync('ls /Volumes', { encoding: 'utf-8' })
    return output
      .split('\n')
      .filter((v) => v.trim() && !v.startsWith('com.apple'))
  } catch (e) {
    return []
  }
}

function chooseItem(items, title) {
  return new Promise((resolve) => {
    console.log(`\n${title}:`)
    items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`))
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question('\n请输入序号: ', (answer) => {
      rl.close()
      const idx = parseInt(answer) - 1
      if (idx >= 0 && idx < items.length) resolve(idx)
      else {
        console.log('❌ 无效选择')
        resolve(-1)
      }
    })
  })
}

function canReadDir(dir) {
  try {
    fs.accessSync(dir, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
}

async function chooseSaveLocation() {
  const options = ['📁 桌面', '📁 硬盘根目录（和之前一样）']
  const idx = await chooseItem(options, '💾 请选择清单保存位置')
  if (idx === 0) {
    const home = process.env.HOME
    if (!home) {
      console.log('❌ 无法获取用户目录')
      return null
    }
    return path.join(home, 'Desktop')
  } else if (idx === 1) {
    return null
  }
  return null
}

// 递归选择文件夹
async function chooseFolderDeep(rootPath) {
  let currentPath = rootPath
  let folderName = '全盘'
  const maxDepth = 10
  let depth = 0

  while (depth < maxDepth) {
    depth++
    const items = fs.readdirSync(currentPath)
    const dirs = items
      .filter((i) => {
        try {
          const p = path.join(currentPath, i)
          return fs.statSync(p).isDirectory() && canReadDir(p)
        } catch {
          return false
        }
      })
      .sort()

    const options = [
      ...dirs.map((d) => `📁 ${d}`),
      '🔙 返回上一层',
      '✅ 选择当前目录（开始扫描）',
    ]

    const idx = await chooseItem(options, `📂 当前目录: ${currentPath}`)
    if (idx < 0) return null

    if (idx < dirs.length) {
      currentPath = path.join(currentPath, dirs[idx])
      folderName = dirs[idx]
    } else if (idx === dirs.length) {
      const parent = path.dirname(currentPath)
      if (parent === currentPath || currentPath === rootPath) {
        console.log('⚠️ 已经在根目录，无法返回')
        continue
      }
      currentPath = parent
      folderName = path.basename(currentPath)
    } else if (idx === dirs.length + 1) {
      return { targetPath: currentPath, folderName }
    }
  }
  return null
}

async function main() {
  const volumes = getVolumes()
  if (volumes.length === 0) {
    console.log('❌ 没有找到已挂载的硬盘')
    return
  }
  const volIdx = await chooseItem(volumes, '💾 请选择硬盘')
  if (volIdx < 0) return
  const rootPath = `/Volumes/${volumes[volIdx]}`
  const diskName = volumes[volIdx]

  const result = await chooseFolderDeep(rootPath)
  if (!result) return
  const { targetPath, folderName } = result

  const saveDir = await chooseSaveLocation()

  const now = new Date()
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

  const cleanDisk = sanitizeFilename(diskName)
  const cleanFolder = sanitizeFilename(folderName)
  const fileName = `${cleanDisk}_${cleanFolder}_目录清单_${timestamp}.txt`

  const outputPath = saveDir
    ? path.join(saveDir, fileName)
    : path.join(rootPath, fileName)

  console.log(`\n🚀 开始扫描: ${targetPath}`)
  console.log('⏳ 扫描中，请稍候...\n')

  const lines = []
  let totalFolders = 0,
    totalFiles = 0
  let skippedFolders = 0
  let scannedFolders = 0

  function showProgress() {
    readline.cursorTo(process.stdout, 0)
    process.stdout.write(
      `📂 已扫描 ${scannedFolders} 个文件夹，${totalFiles} 个文件`,
    )
  }

  function walk(dir, pre = '') {
    if (!canReadDir(dir)) {
      skippedFolders++
      return
    }

    let items
    try {
      items = fs.readdirSync(dir)
    } catch (e) {
      skippedFolders++
      return
    }

    const dirs = []
    let files = 0
    for (const i of items) {
      const p = path.join(dir, i)
      try {
        const s = fs.statSync(p)
        if (s.isDirectory()) {
          if (canReadDir(p)) {
            dirs.push(i)
          } else {
            skippedFolders++
          }
        } else {
          files++
        }
      } catch (e) {}
    }

    const name = path.basename(dir)
    const line =
      files > 0 ? `${pre}📁 ${name} (${files}个文件)` : `${pre}📁 ${name}`
    lines.push(line)
    totalFolders++
    totalFiles += files
    scannedFolders++
    showProgress()

    for (const d of dirs) {
      walk(path.join(dir, d), pre + '  ')
    }
  }

  lines.push(`📂 ${targetPath}`)
  lines.push(`📅 ${new Date().toLocaleString()}`)
  lines.push('─'.repeat(50))
  walk(targetPath)

  console.log('\n')

  lines.push('─'.repeat(50))
  lines.push(`📊 ${totalFolders} 个文件夹，${totalFiles} 个文件`)
  if (skippedFolders > 0) {
    lines.push(`⚠️ 跳过 ${skippedFolders} 个无权限的文件夹`)
  }

  fs.writeFileSync(outputPath, lines.join('\n'))
  console.log(`✅ 目录清单已生成: ${outputPath}`)
  console.log(`📊 ${totalFolders} 个文件夹，${totalFiles} 个文件`)
  if (skippedFolders > 0) {
    console.log(`⚠️ 跳过 ${skippedFolders} 个无权限的文件夹`)
  }
}

main().catch(console.error)
