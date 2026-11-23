import type { CrashAnalysis } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import { p } from './paths'

const HINTS: { test: RegExp; hint: string }[] = [
  { test: /java\.lang\.OutOfMemoryError|Java heap space/i, hint: 'Не хватает памяти — увеличьте объём ОЗУ для сборки в настройках.' },
  {
    test: /UnsupportedClassVersionError|class file version/i,
    hint: 'Неподходящая версия Java. Включите автоподбор Java или выберите версию, которую требует игра.',
  },
  {
    test: /Incompatible mod set|Missing or unsupported mandatory dependencies|Mod resolution failed|ModResolutionException/i,
    hint: 'Конфликт или отсутствие зависимостей модов. Проверьте версии модов и их требования.',
  },
  {
    test: /NoSuchMethodError|NoClassDefFoundError|ClassNotFoundException|Mixin apply failed|MixinTransformerError/i,
    hint: 'Несовместимая версия мода или конфликт модов. Попробуйте обновить подозреваемый мод.',
  },
  { test: /GLFW error|Pixel format not accelerated|OpenGL/i, hint: 'Проблема с драйверами видеокарты или OpenGL. Обновите драйверы.' },
  { test: /Could not find or load main class|ClassNotFoundException: net\.minecraft/i, hint: 'Файлы версии повреждены — переустановите версию.' },
  { test: /Address already in use/i, hint: 'Порт уже занят другим процессом. Закройте лишние программы.' },
  { test: /Failed to download|Unable to access|UnknownHostException|ConnectException/i, hint: 'Проблемы с сетью или доступом к файлам. Проверьте интернет и антивирус.' },
]

function modBaseName(file: string): string {
  const base = file.replace(/\.(jar|zip)(\.disabled)?$/i, '')
  const clean = base.replace(/[-+_\s]?\d[\w.+-]*$/, '')
  return clean.replace(/[-_+]+$/, '')
}

async function newestReport(instanceId: string, since: number): Promise<{ path: string; text: string; at: number } | null> {
  const dir = path.join(p.instance(instanceId), 'crash-reports')
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const reports = entries
    .filter((e) => e.isFile() && /\.txt$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
  if (reports.length === 0) return null

  const withStats = await Promise.all(
    reports.map(async (file) => {
      try {
        const stat = await fs.promises.stat(file)
        return { file, mtime: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )
  const valid = withStats.filter((x): x is { file: string; mtime: number } => !!x && x.mtime >= since - 5000)
  const chosen = (
    valid.length > 0
      ? valid
      : withStats.filter((x): x is { file: string; mtime: number } => x !== null)
  ).sort((a, b) => b.mtime - a.mtime)[0]
  if (!chosen) return null

  try {
    const text = await fs.promises.readFile(chosen.file, 'utf8')
    return { path: chosen.file, text: text.slice(0, 120000), at: chosen.mtime }
  } catch {
    return null
  }
}

function extractReason(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  const descriptionIndex = lines.findIndex((line) => /^Description:/i.test(line.trim()))
  if (descriptionIndex >= 0) {
    for (const line of lines.slice(descriptionIndex + 1, descriptionIndex + 5)) {
      const trimmed = line.trim()
      if (trimmed && !/^Stacktrace:/i.test(trimmed)) return trimmed.slice(0, 220)
    }
  }
  const exception = lines.find((line) => /^(java|net|cpw|org)\.[\w.]*Exception|Exception in thread/i.test(line.trim()))
  return exception?.trim().slice(0, 220)
}

export async function analyzeCrash(
  instanceId: string,
  logLines: string[],
  startedAt: number,
  exitAt: number,
): Promise<CrashAnalysis> {
  const report = await newestReport(instanceId, startedAt)
  const tail = logLines.slice(-500).join('\n')
  const text = [report?.text ?? '', tail].join('\n')
  const lower = text.toLowerCase()

  const hints = HINTS.filter(({ test }) => test.test(text)).map(({ hint }) => hint)

  const suspects: { name: string; score: number }[] = []
  try {
    const files = await fs.promises.readdir(p.instanceMods(instanceId))
    for (const file of files) {
      if (!/\.(jar|zip)(\.disabled)?$/i.test(file)) continue
      const name = modBaseName(file)
      if (name.length < 3) continue
      const needle = name.toLowerCase()
      let score = 0
      let index = lower.indexOf(needle)
      while (index >= 0) {
        score++
        index = lower.indexOf(needle, index + needle.length)
      }
      if (score > 0) suspects.push({ name, score })
    }
  } catch {
    /* папки модов может ещё не быть */
  }

  suspects.sort((a, b) => b.score - a.score)
  const top = suspects.slice(0, 3).map((s) => s.name)
  if (top.length > 0) {
    hints.unshift(
      `Подозреваемые моды: ${top.join(', ')}. Попробуйте обновить их или отключить по одному, чтобы найти конфликт.`,
    )
  }

  return {
    crashedAt: report?.at ?? exitAt,
    reason: extractReason(report?.text ?? tail),
    suspects: top,
    hints,
    reportFile: report ? path.basename(report.path) : undefined,
  }
}
