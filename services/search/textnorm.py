"""Cross-script name normalisation for RU / KK / EN / transliterated search.

`skeleton()` maps Cyrillic (Russian + Kazakh letters) and Latin spellings (BGN/PCGN-like, Kazakh Latin 2018/2021,
informal "Almati") to one loose comparison form, so "Алматы", "Almaty", "Almati" and "Алма-Ата"->"alma ata" tokens
compare equal token-by-token. It is used both when building the index and when parsing queries, so both sides always
agree. It never replaces displayed names; real OSM names are stored and returned unchanged.
"""
import re
import unicodedata

_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)

# Cyrillic -> Latin (Russian + Kazakh). Multi-letter results are normalised again by _LATIN_RULES.
_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    # Kazakh additions
    "ә": "a", "ғ": "g", "қ": "k", "ң": "n", "ө": "o", "ұ": "u", "ү": "u", "һ": "h", "і": "i",
    # other Cyrillic seen in Central Asian OSM names
    "ў": "u", "ҳ": "h", "ҷ": "j", "ӣ": "i", "ӯ": "u", "ґ": "g", "є": "e", "ї": "i",
}
_LATIN_EXTRA = {"ı": "i", "ə": "a", "ß": "ss", "ł": "l", "đ": "d", "ø": "o", "æ": "ae", "œ": "oe", "ş": "sh", "ç": "ch", "ğ": "g"}

# Applied in order on lower-case Latin text.
# Distinct private symbols (never produced by plain letters) keep ш/ч/ж/ц apart from с/к/з.
_LATIN_RULES = (
    ("shch", "ş"), ("sch", "ş"), ("sh", "ş"), ("ch", "ç"), ("dzh", "ž"), ("zh", "ž"), ("kh", "k"), ("gh", "g"),
    ("ph", "f"), ("ts", "ţ"), ("ck", "k"),
)
_LATIN_SINGLE = {"q": "k", "c": "k", "w": "v", "x": "ks", "y": "i", "j": "ž"}
_KEEP = re.compile(r"[^0-9a-zşçžţ]")


def _strip_marks(text):
    # Keep Cyrillic letters like "й" / "ё" intact: only decompose non-Cyrillic characters.
    out = []
    for ch in text:
        if "Ѐ" <= ch <= "ӿ":
            out.append(ch)
        else:
            out.append("".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c)))
    return "".join(out)


def to_latin(text):
    text = unicodedata.normalize("NFC", str(text or "")).casefold()
    text = _strip_marks(text)
    out = []
    for ch in text:
        out.append(_CYRILLIC.get(ch) if ch in _CYRILLIC else _LATIN_EXTRA.get(ch, ch))
    return "".join(out)


def skeleton_token(token):
    """Skeleton for one token (letters/digits only). Returns '' for tokens with no letters/digits."""
    latin = to_latin(token)
    for src, dst in _LATIN_RULES:
        latin = latin.replace(src, dst)
    latin = "".join(_LATIN_SINGLE.get(ch, ch) for ch in latin)
    latin = _KEEP.sub("", latin)
    return re.sub(r"(.)\1+", r"\1", latin)  # collapse doubled letters (Allaty/Alaty)


def tokens(text):
    return _TOKEN.findall(unicodedata.normalize("NFC", str(text or "")))


def skeleton_tokens(text):
    return [s for s in (skeleton_token(t) for t in tokens(text)) if s]


def skeleton(text):
    return " ".join(skeleton_tokens(text))


def importance(kind, population=None, capital=False):
    """Deterministic prominence score from real OSM attributes only (place class, population, capital tag).
    No external popularity signal is invented; unknown kinds get the lowest tier."""
    base = {"country": 1000, "state": 800, "city": 700, "town": 600, "municipality": 520, "village": 400,
            "suburb": 380, "district": 380, "neighbourhood": 340, "quarter": 340, "hamlet": 260, "locality": 220,
            "isolated_dwelling": 120}.get(kind, 100 if kind != "address" else 40)
    score = base
    if population:
        try:
            pop = int(str(population).replace(" ", "").split(";")[0])
        except ValueError:
            pop = 0
        if pop > 0:
            score += min(120, int(pop ** 0.5 / 12))  # 1M people -> +83, 3M -> +120 (capped)
    if capital:
        score += 60
    return score
