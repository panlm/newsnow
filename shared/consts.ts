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
 * 每个源最多保留的条数
 */
export const MaxItems = 100

export const Homepage = packageJSON.homepage

export const Version = packageJSON.version
export const Author = packageJSON.author
