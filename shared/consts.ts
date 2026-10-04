/**
 * 缓存过期时间
 */
import packageJSON from "../package.json"

export const TTL = 30 * 60 * 1000
/**
 * 默认刷新间隔, 10 min
 */
export const Interval = 10 * 60 * 1000
/**
 * 每个源最多保留的条数，源可以用 maxItems 单独放宽
 */
export const MaxItems = 100
/**
 * AWS Blog 按时间保留：最近 AwsBlogDays 天的文章全部保留，不足 MaxItems 时补到 MaxItems
 */
export const AwsBlogDays = 8
/**
 * AWS Blog 的条数上限，只防极端情况（历史上最密的 8 天是 239 篇，2025 re:Invent 前一周）
 */
export const AwsBlogMaxItems = 500

export const Homepage = packageJSON.homepage

export const Version = packageJSON.version
export const Author = packageJSON.author
