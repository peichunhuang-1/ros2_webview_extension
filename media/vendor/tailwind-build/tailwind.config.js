const COLOR_RE = '(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|blue|indigo|violet|purple|pink|rose)';
const SHADE_RE = '(50|100|200|300|400|500|600|700|800|900)';
const SPACE_RE = '(0|1|2|3|4|5|6|8|10|12|14|16|20|24|32|40|48|56|64|px)';
const SIZE_RE = '(0|1|2|3|4|5|6|8|10|12|16|20|24|32|40|48|56|64|px|full|screen|min|max|fit|auto|1\\/2|1\\/3|2\\/3|1\\/4|3\\/4)';

module.exports = {
  content: ['./dummy.html'],
  darkMode: 'media',
  safelist: [
    { pattern: new RegExp(`^(bg|text|border|ring)-${COLOR_RE}-${SHADE_RE}$`), variants: ['hover', 'focus'] },
    { pattern: /^(bg|text|border|ring)-(white|black|transparent|current)$/, variants: ['hover', 'focus'] },
    { pattern: new RegExp(`^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|inset|top|right|bottom|left)-${SPACE_RE}$`) },
    { pattern: new RegExp(`^-(m|mx|my|mt|mr|mb|ml|inset|top|right|bottom|left)-${SPACE_RE}$`) },
    { pattern: new RegExp(`^(w|h|min-w|min-h|max-w|max-h)-${SIZE_RE}$`) },
    { pattern: /^(text)-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/ },
    { pattern: /^(font)-(thin|light|normal|medium|semibold|bold|extrabold|sans|serif|mono)$/ },
    { pattern: /^(leading)-(none|tight|snug|normal|relaxed|loose)$/ },
    { pattern: /^(tracking)-(tight|normal|wide|wider)$/ },
    { pattern: /^(rounded)(-(sm|md|lg|xl|2xl|full|none|t|b|l|r))?$/ },
    { pattern: /^(shadow)(-(sm|md|lg|xl|2xl|inner|none))?$/, variants: ['hover'] },
    { pattern: /^(border)(-(0|2|4|8|t|b|l|r))?$/ },
    { pattern: /^(opacity)-(0|25|50|75|90|100)$/, variants: ['hover'] },
    { pattern: /^(scale)-(90|95|100|105|110)$/, variants: ['hover'] },
    { pattern: /^(z)-(0|10|20|30|40|50|auto)$/ },
    { pattern: /^(grid-cols|grid-rows)-([1-9]|1[0-2]|none)$/ },
    { pattern: /^(col-span|row-span)-([1-9]|1[0-2]|full)$/ },
    { pattern: /^(gap|gap-x|gap-y)-/ },
    { pattern: /^(justify|content|items|self|place)-(start|end|center|between|around|evenly|stretch|baseline|auto)(-(start|end|center|between|around|evenly|stretch|baseline))?$/ },
    { pattern: /^(transition)(-(none|all|colors|opacity|shadow|transform))?$/ },
    { pattern: /^(duration)-(75|100|150|200|300|500)$/ },
    { pattern: /^(ease)-(linear|in|out|in-out)$/ },
  ],
};
