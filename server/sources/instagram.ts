import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { NewsItem } from "@shared/types"
import { withBilingualHover } from "#/utils/translate"

// Instagram has no public "trending/热搜" (topsearch demands login). A public
// account's recent posts ARE reachable via web_profile_info with the public web
// app id — BUT Instagram 429s undici's TLS fingerprint while letting curl through,
// so we shell out to curl (present in the alpine image). Unofficial endpoint:
// best-effort, Instagram may still throttle/block, so each account degrades to [].
const execFileAsync = promisify(execFile)
const ACCOUNTS = ["bbcnews", "cnn", "reuters"]
const APP_ID = "936619743392459"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

interface IGNode {
  shortcode?: string
  taken_at_timestamp?: number
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] }
  edge_liked_by?: { count?: number }
}

function caption(node: IGNode) {
  const text = node.edge_media_to_caption?.edges?.[0]?.node?.text
  return text?.replace(/\s+/g, " ").trim() ?? ""
}

async function fetchAccount(username: string): Promise<{ node: IGNode, account: string }[]> {
  try {
    const { stdout } = await execFileAsync("curl", [
      "-s",
      "--compressed",
      "--max-time",
      "20",
      "-H",
      `User-Agent: ${UA}`,
      "-H",
      `x-ig-app-id: ${APP_ID}`,
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 25000 })
    const data = JSON.parse(stdout)
    const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges ?? []
    return edges
      .map((e: any) => ({ node: e?.node as IGNode, account: username }))
      .filter((x: any) => x.node?.shortcode)
  } catch {
    return []
  }
}

export default defineSource(async () => {
  const all = (await Promise.all(ACCOUNTS.map(fetchAccount))).flat()
  if (!all.length) throw new Error("Instagram returned no posts")
  all.sort((a, b) => (b.node.taken_at_timestamp ?? 0) - (a.node.taken_at_timestamp ?? 0))

  const items = all.slice(0, 30).map<NewsItem>(({ node, account }) => {
    const cap = caption(node)
    const title = cap ? cap.slice(0, 100) : `@${account}`
    return {
      id: node.shortcode!,
      title,
      url: `https://www.instagram.com/p/${node.shortcode}/`,
      pubDate: node.taken_at_timestamp ? node.taken_at_timestamp * 1000 : undefined,
      extra: {
        info: `@${account} · ♥ ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(node.edge_liked_by?.count ?? 0)}`,
        hover: cap,
      },
    }
  })
  return withBilingualHover(items)
})
