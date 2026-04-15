const LEADING_INDENT = '[ \t　]{0,4}';
const REQUIRED_LEADING_SPACE = '[ \t　]+';
const OPTIONAL_INLINE_SPACE = '[ \t　]{0,4}';
const CJK_NUMERALS = '\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟';
const CHAPTER_KEYWORDS = '序章|楔子|正文(?!完|结)|终章|后记|尾声|番外';
const CHAPTER_ORDINAL = `第${OPTIONAL_INLINE_SPACE}[${CJK_NUMERALS}]+?${OPTIONAL_INLINE_SPACE}`;
const ENGLISH_TITLE_SEPARATOR = '[:：.]|[-_—]';
const ENGLISH_TITLE_LEAD = '(?:\\p{Lu}|\\d|["“‘(\\[{【「『〈《])';

function escapeRegExpChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function asciiCaseInsensitive(word: string): string {
  return Array.from(word)
    .map((char) => {
      if (/[A-Za-z]/.test(char)) {
        return `[${char.toUpperCase()}${char.toLowerCase()}]`;
      }

      return escapeRegExpChar(char);
    })
    .join('');
}

function asciiAlternatives(words: string[]): string {
  return `(?:${words.map(asciiCaseInsensitive).join('|')})`;
}

const ENGLISH_SPECIAL_HEADINGS = asciiAlternatives([
  'prologue',
  'epilogue',
  'preface',
  'foreword',
  'afterword',
  'introduction',
  'interlude',
  'conclusion',
  'appendix',
]);
const ENGLISH_CHAPTER_LABEL = asciiAlternatives(['chapter', 'ch.']);
const ENGLISH_PART_LABEL = asciiAlternatives(['part', 'book', 'volume']);
const ENGLISH_SECTION_LABEL = asciiAlternatives(['section', 'episode']);
const ENGLISH_NO_LABEL = asciiAlternatives(['no.', 'no、']);
const ENGLISH_SMALL_CARDINALS = asciiAlternatives([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]);
const ENGLISH_TEENS = asciiAlternatives([
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]);
const ENGLISH_TENS = asciiAlternatives(['twenty', 'thirty', 'forty', 'fifty']);
const ENGLISH_CARDINAL_WORDS = `(?:${ENGLISH_SMALL_CARDINALS}|${ENGLISH_TEENS}|${ENGLISH_TENS}(?:[- ](?:${ENGLISH_SMALL_CARDINALS}))?)`;
const ENGLISH_ORDINAL_WORDS = asciiAlternatives([
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
  'thirtieth',
  'fortieth',
  'fiftieth',
]);
const ENGLISH_ROMAN_NUMERALS = '[IVXLCDMivxlcdm]+';
const ENGLISH_NUMBER_TOKEN = `(?:\\d{1,4}|${ENGLISH_ROMAN_NUMERALS}|${ENGLISH_CARDINAL_WORDS}|${ENGLISH_ORDINAL_WORDS})`;
const ENGLISH_NUMBERED_TITLE_SUFFIX = `(?:${OPTIONAL_INLINE_SPACE}(?:${ENGLISH_TITLE_SEPARATOR})${OPTIONAL_INLINE_SPACE}.{1,40}|${REQUIRED_LEADING_SPACE}${ENGLISH_TITLE_LEAD}.{0,40})?`;
const ENGLISH_SPECIAL_TITLE_SUFFIX = `(?:${OPTIONAL_INLINE_SPACE}(?:${ENGLISH_TITLE_SEPARATOR})${OPTIONAL_INLINE_SPACE}.{1,40})?`;

export interface TxtChapterRuleDefinition {
  name: string;
  source: string;
  flags: string;
  example: string;
  serialNumber: number;
  enable: boolean;
}

export interface TxtChapterRule extends TxtChapterRuleDefinition {
  pattern: RegExp;
}

function createRule(definition: TxtChapterRuleDefinition): TxtChapterRule {
  return {
    ...definition,
    pattern: new RegExp(definition.source, definition.flags),
  };
}

const BUILTIN_RULE_DEFINITIONS = [
  {
    name: '中式章节 基础规则',
    source: '^第[0-9一二三四五六七八九十百千零两]+[章回节卷部篇].*$',
    flags: 'u',
    example: '第1章 初见',
    serialNumber: -20,
    enable: true,
  },
  {
    name: 'Chapter/Ch. 序号 标题',
    source: `^${LEADING_INDENT}${ENGLISH_CHAPTER_LABEL}${OPTIONAL_INLINE_SPACE}${ENGLISH_NUMBER_TOKEN}${ENGLISH_NUMBERED_TITLE_SUFFIX}$`,
    flags: 'u',
    example: 'Chapter 1',
    serialNumber: -10,
    enable: true,
  },
  {
    name: 'Part/Book/Volume 序号 标题',
    source: `^${LEADING_INDENT}${ENGLISH_PART_LABEL}${OPTIONAL_INLINE_SPACE}${ENGLISH_NUMBER_TOKEN}${ENGLISH_NUMBERED_TITLE_SUFFIX}$`,
    flags: 'u',
    example: 'Part II The Long Road',
    serialNumber: -9,
    enable: true,
  },
  {
    name: 'Prologue/Epilogue 等英文单章标题',
    source: `^${LEADING_INDENT}${ENGLISH_SPECIAL_HEADINGS}${ENGLISH_SPECIAL_TITLE_SUFFIX}$`,
    flags: 'u',
    example: 'Prologue: Before the Storm',
    serialNumber: -8,
    enable: true,
  },
  {
    name: 'Section/Episode 序号 标题',
    source: `^${LEADING_INDENT}${ENGLISH_SECTION_LABEL}${OPTIONAL_INLINE_SPACE}${ENGLISH_NUMBER_TOKEN}${ENGLISH_NUMBERED_TITLE_SUFFIX}$`,
    flags: 'u',
    example: 'Episode IV A New Dawn',
    serialNumber: -7,
    enable: true,
  },
  {
    name: '目录(去空白)',
    source: `^${REQUIRED_LEADING_SPACE}(?:${CHAPTER_KEYWORDS}|${CHAPTER_ORDINAL}(?:章|节(?!课)|卷|集(?![合和]))).{0,30}$`,
    flags: 'u',
    example: '   第一章 假装第一章前面有空白但我不要',
    serialNumber: 0,
    enable: true,
  },
  {
    name: '目录',
    source: `^${LEADING_INDENT}(?:${CHAPTER_KEYWORDS}|${CHAPTER_ORDINAL}(?:章|节(?!课)|卷|集(?![合和])|部(?![分赛游])|篇(?!张))).{0,30}$`,
    flags: 'u',
    example: '第一章 标准的粤语就是这样',
    serialNumber: 1,
    enable: true,
  },
  {
    name: '数字 分隔符 标题名称',
    source: `^${LEADING_INDENT}\\d{1,5}[:：,.， 、_—\\-].{1,30}$`,
    flags: 'u',
    example: '1、这个就是标题',
    serialNumber: 7,
    enable: true,
  },
  {
    name: '大写数字 分隔符 标题名称',
    source: `^${LEADING_INDENT}(?:${CHAPTER_KEYWORDS}|[零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章?)[ 、_—\\-].{1,30}$`,
    flags: 'u',
    example: '二十四章 我瞎编的标题',
    serialNumber: 8,
    enable: true,
  },
  {
    name: '正文 标题/序号',
    source: `^${LEADING_INDENT}正文[ \\u3000]{1,4}.{0,20}$`,
    flags: 'u',
    example: '正文 我奶常山赵子龙',
    serialNumber: 10,
    enable: true,
  },
  {
    name: 'Chapter/Section/Part/Episode 序号 标题',
    source: `^${LEADING_INDENT}(?:${ENGLISH_CHAPTER_LABEL}|${ENGLISH_SECTION_LABEL}|${ENGLISH_PART_LABEL}|ＰＡＲＴ|${ENGLISH_NO_LABEL}|(?:内容|文章)?简介|文案|前言|${CHAPTER_KEYWORDS})${OPTIONAL_INLINE_SPACE}\\d{1,4}(?:${OPTIONAL_INLINE_SPACE}(?:${ENGLISH_TITLE_SEPARATOR})${OPTIONAL_INLINE_SPACE}.{1,30}|${REQUIRED_LEADING_SPACE}${ENGLISH_TITLE_LEAD}.{0,30})?$`,
    flags: 'u',
    example: 'Chapter 1 MyGrandmaIsNB',
    serialNumber: 11,
    enable: true,
  },
  {
    name: 'Chapter(去简介)',
    source: `^${LEADING_INDENT}(?:${ENGLISH_CHAPTER_LABEL}|${ENGLISH_SECTION_LABEL}|${ENGLISH_PART_LABEL}|ＰＡＲＴ|${asciiAlternatives(['no.'])})${OPTIONAL_INLINE_SPACE}\\d{1,4}(?:${OPTIONAL_INLINE_SPACE}(?:${ENGLISH_TITLE_SEPARATOR})${OPTIONAL_INLINE_SPACE}.{1,30}|${REQUIRED_LEADING_SPACE}${ENGLISH_TITLE_LEAD}.{0,30})?$`,
    flags: 'u',
    example: 'Chapter 1 MyGrandmaIsNB',
    serialNumber: 12,
    enable: true,
  },
  {
    name: '特殊符号 序号 标题',
    source: `^${LEADING_INDENT}[【〔〖「『〈［\\[](?:第|[Cc]hapter)[${CJK_NUMERALS}]{1,10}[章节].{0,20}$`,
    flags: 'u',
    example: '【第一章 后面的符号可以没有',
    serialNumber: 13,
    enable: true,
  },
  {
    name: '特殊符号 标题(单个)',
    source: `^${LEADING_INDENT}(?:[☆★✦✧].{1,30}|(?:内容|文章)?简介|文案|前言|${CHAPTER_KEYWORDS})[ \\u3000]{0,4}$`,
    flags: 'u',
    example: '☆、晋江作者最喜欢的格式',
    serialNumber: 15,
    enable: true,
  },
  {
    name: '章/卷 序号 标题',
    source: `^${LEADING_INDENT}(?:(?:内容|文章)?简介|文案|前言|${CHAPTER_KEYWORDS}|[卷章][${CJK_NUMERALS}]{1,8})[ \\u3000]{0,4}.{0,30}$`,
    flags: 'u',
    example: '卷五 开源盛世',
    serialNumber: 16,
    enable: true,
  },
  {
    name: '书名 括号 序号',
    source: `^[一-龥]{1,20}${LEADING_INDENT}[(（][${CJK_NUMERALS}]{1,8}[)）]${LEADING_INDENT}$`,
    flags: 'u',
    example: '标题后面数字有括号(12)',
    serialNumber: 20,
    enable: true,
  },
  {
    name: '书名 序号',
    source: `^[一-龥]{1,20}${LEADING_INDENT}[${CJK_NUMERALS}]{1,8}${LEADING_INDENT}$`,
    flags: 'u',
    example: '标题后面数字没有括号124',
    serialNumber: 21,
    enable: true,
  },
  {
    name: '字数分割 分节阅读',
    source: `^${LEADING_INDENT}(?:.{0,15}分[页节章段]阅读[-_ ]|第${OPTIONAL_INLINE_SPACE}[${CJK_NUMERALS}]{1,6}${OPTIONAL_INLINE_SPACE}[页节]).{0,30}$`,
    flags: 'u',
    example: '第一页 翻页测试',
    serialNumber: 23,
    enable: true,
  },
] satisfies TxtChapterRuleDefinition[];

export const BUILTIN_TXT_CHAPTER_RULES = BUILTIN_RULE_DEFINITIONS
  .map(createRule)
  .sort((left, right) => left.serialNumber - right.serialNumber);

export const AUTO_TXT_CHAPTER_PATTERNS = BUILTIN_TXT_CHAPTER_RULES
  .filter((rule) => rule.enable)
  .map((rule) => rule.pattern);
