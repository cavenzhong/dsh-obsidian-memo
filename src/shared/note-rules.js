/** 两端共用的标题模式、文件名模板与限额；不依赖运行环境。 */
export const TITLE_MODES = Object.freeze(['filename', 'firstLine', 'heading'])
export const DEFAULT_TITLE_MODE = 'filename'
export const DEFAULT_FILE_NAME_PATTERN = '{date}-{time}'
export const FILE_NAME_TOKENS = Object.freeze(['{title}', '{date}', '{time}', '{timestamp}'])
export const FILE_NAME_PATTERN_MAX = 120
export const NOTE_NAME_MAX_BYTES = 240
