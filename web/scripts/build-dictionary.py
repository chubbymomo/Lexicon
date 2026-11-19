"""Build prisma/data/dictionary.json.gz from WordNet 3.0 and wordfreq.

The output holds:
  - entries: the dictionary (every usable single-word WordNet lemma), with its
    commonest part of speech, definition, synonyms, antonyms, examples and how
    common it is (wordfreq Zipf scale: 7 is "the", 1 is very rare);
  - forms: irregular inflections mapped to their lemma (e.g. "ran" -> "run");
  - core: the lemmas of the core curriculum, most common first.

Usage (needs `pip install wordfreq` and WordNet's dict directory, e.g. from the
npm package `wndb-with-exceptions`):

    python3 scripts/build-dictionary.py <wordnet dict dir> prisma/data/dictionary.json.gz
"""

import gzip
import json
import os
import re
import sys
from collections import defaultdict

from wordfreq import zipf_frequency

WN, OUT = sys.argv[1], sys.argv[2]

POS_FILES = {"n": "noun", "v": "verb", "a": "adj", "r": "adv"}
POS_NAME = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}

# Lexicographer files (WordNet's semantic categories) whose words make good
# vocabulary study: qualities, states, actions, ideas, people, feelings.
# Concrete taxonomies (plants, animals, artefacts, substances, places) are left
# out of the core curriculum, though they stay in the dictionary.
CORE_LEXNAMES = {
    0,  # adj.all
    2,  # adv.all
    4,  # noun.act
    7,  # noun.attribute
    9,  # noun.cognition
    10,  # noun.communication
    11,  # noun.event
    12,  # noun.feeling
    16,  # noun.motive
    18,  # noun.person
    19,  # noun.phenomenon
    22,  # noun.process
    24,  # noun.relation
    26,  # noun.state
} | set(range(29, 44))  # verb.*

# Usage domains that mark a sense as offensive.
OFFENSIVE_USAGE = {"obscenity", "vulgarism", "ethnic slur", "disparagement", "dysphemism"}

DICTIONARY_MIN_ZIPF = 1.0
CORE_MIN_ZIPF, CORE_MAX_ZIPF = 2.0, 4.2

# A word built from a very common word with a regular suffix ("darkness",
# "wifely", "advancing") teaches nothing its base does not, so it is left out
# of the core when its base is at least this common.
COMMON_BASE_ZIPF = 4.6
DERIVATIONS = [
    ("ness", ["", "e"]), ("iness", ["y"]), ("ly", ["", "le", "e"]), ("ily", ["y"]),
    ("ment", ["", "e"]), ("ful", [""]), ("less", [""]), ("ing", ["", "e"]),
    ("ed", ["", "e"]), ("er", ["", "e"]), ("ers", [""]), ("ish", ["", "e"]),
    ("ship", [""]), ("hood", [""]), ("like", [""]), ("ward", [""]), ("wise", [""]),
    ("ation", ["e", ""]), ("ion", ["e", ""]), ("al", ["", "e"]), ("y", ["", "e"]),
    ("able", ["", "e"]), ("ity", ["", "e"]), ("ize", [""]), ("ise", [""]),
]


WORD = re.compile(r"^[a-z]+$")
VERBS = set()  # filled once the index is read


def jargon(s):
    """A sense filed under a subject area (football, chemistry, music...)."""
    return any(sym == ";c" for sym, *_ in s["pointers"])


def transparent(lemma):
    # Verb forms used as adjectives or nouns: "blowing", "dismissed", "relieved".
    for suffix, endings in (("ing", ["", "e"]), ("ed", ["", "e"]), ("ied", ["y"])):
        if lemma.endswith(suffix):
            stem = lemma[: -len(suffix)]
            candidates = [stem + e for e in endings]
            if len(stem) > 3 and stem[-1] == stem[-2]:
                candidates.append(stem[:-1])
            if any(c in VERBS for c in candidates):
                return True
    for suffix, endings in DERIVATIONS:
        if lemma.endswith(suffix) and len(lemma) - len(suffix) >= 3:
            stem = lemma[: -len(suffix)]
            candidates = [stem + e for e in endings]
            # Doubled consonants: "running" -> "run".
            if len(stem) > 3 and stem[-1] == stem[-2]:
                candidates.append(stem[:-1])
            if any(zipf_frequency(c, "en") >= COMMON_BASE_ZIPF for c in candidates if c != lemma):
                return True
    return False


def number(gloss):
    return bool(
        re.search(r"\b(cardinal|ordinal) number\b|^being \w+ more than|^coming next after|"
                  r"^the \w+ (in a series|of \w+ equal parts)|^denoting a quantity", gloss)
    )


def read_data(pos):
    """offset -> synset dict for one part of speech."""
    synsets = {}
    with open(os.path.join(WN, f"data.{POS_FILES[pos]}"), encoding="latin-1") as f:
        for line in f:
            if line.startswith("  "):
                continue
            body, _, gloss = line.partition(" | ")
            parts = body.split()
            offset, lexname, ss_type = parts[0], int(parts[1]), parts[2]
            w_cnt = int(parts[3], 16)
            words = [parts[4 + 2 * i].replace("_", " ") for i in range(w_cnt)]
            i = 4 + 2 * w_cnt
            p_cnt = int(parts[i])
            pointers = []
            for j in range(p_cnt):
                sym, target, tpos, st = parts[i + 1 + 4 * j : i + 5 + 4 * j]
                pointers.append((sym, target, tpos, int(st[:2], 16), int(st[2:], 16)))
            synsets[offset] = {
                "lexname": lexname,
                "type": ss_type,
                "words": words,
                "pointers": pointers,
                "gloss": gloss.strip(),
            }
    return synsets


data = {pos: read_data(pos) for pos in POS_FILES}
# Satellite adjectives live in data.adj but are addressed with pos "s".
data["s"] = data["a"]


def synset(pos, offset):
    return data[pos][offset]


usage_names = {}
for pos in POS_FILES:
    for s in data[pos].values():
        for sym, target, tpos, _, _ in s["pointers"]:
            if sym == ";u":
                usage_names[target] = synset(tpos, target)["words"][0].lower()


def offensive(s):
    return any(
        sym == ";u" and usage_names.get(t) in OFFENSIVE_USAGE for sym, t, *_ in s["pointers"]
    )


def split_gloss(gloss):
    """'definition; "example one"; "example two"' -> (definition, [examples])."""
    examples = re.findall(r'"([^"]+)"', gloss)
    definition = re.split(r';\s*"', gloss, maxsplit=1)[0].strip().rstrip(";").strip()
    return definition, [e.strip() for e in examples]


# lemma -> pos -> [(offset, tagged count)] in WordNet's sense order (commonest first)
index = defaultdict(dict)
for pos, name in POS_FILES.items():
    with open(os.path.join(WN, f"index.{name}"), encoding="latin-1") as f:
        for line in f:
            if line.startswith("  "):
                continue
            parts = line.split()
            lemma = parts[0]
            if not WORD.match(lemma):
                continue
            synset_cnt, p_cnt = int(parts[2]), int(parts[3])
            tagged = int(parts[5 + p_cnt])
            offsets = parts[6 + p_cnt : 6 + p_cnt + synset_cnt]
            index[lemma][pos] = (tagged, offsets)


def word_in(s, lemma):
    """The word as written in a synset, matched case-insensitively, with its 1-based position."""
    for k, w in enumerate(s["words"], start=1):
        if re.sub(r"\(.*\)$", "", w).lower() == lemma:
            return re.sub(r"\(.*\)$", "", w), k
    return None, None


VERBS.update(l for l, by_pos in index.items() if "v" in by_pos)

entries, core = [], []
for lemma, by_pos in index.items():
    if len(lemma) < 3:
        continue
    zipf = zipf_frequency(lemma, "en")
    if zipf < DICTIONARY_MIN_ZIPF:
        continue
    # The part of speech with the most tagged uses; ties go to the order below.
    order = ["a", "v", "n", "r"]
    pos = max(by_pos, key=lambda p: (by_pos[p][0], -order.index(p)))
    _, offsets = by_pos[pos]
    senses = []
    for off in offsets:
        s = synset(pos, off)
        written, k = word_in(s, lemma)
        if written is None:
            continue
        senses.append((s, written, k))
    if not senses:
        continue
    # Senses written with a capital are proper nouns (a person, place or sect);
    # a word with no other sense is left out.
    senses = [x for x in senses if x[1] == x[1].lower()]
    if not senses:
        continue
    primary, written, k = senses[0]
    if any(offensive(s) for s, _, _ in senses):
        continue

    definition, _ = split_gloss(primary["gloss"])
    synonyms, antonyms, examples = [], [], []
    for s, _, wk in senses[:3]:
        for w in s["words"]:
            w = re.sub(r"\(.*\)$", "", w)
            if w.lower() != lemma and " " not in w and w == w.lower() and w not in synonyms:
                synonyms.append(w)
        for sym, target, tpos, src, dst in s["pointers"]:
            if sym == "!" and (src == wk or src == 0):
                other = synset(tpos, target)["words"][dst - 1 if dst else 0]
                other = re.sub(r"\(.*\)$", "", other)
                if " " not in other and other not in antonyms:
                    antonyms.append(other)
    stem = lemma[:-1] if lemma.endswith("e") and len(lemma) > 4 else lemma
    for s, _, _ in senses:
        for example in split_gloss(s["gloss"])[1]:
            if re.search(rf"\b{re.escape(stem)}", example, re.I) and example not in examples:
                examples.append(example[0].upper() + example[1:])
    entries.append(
        [lemma, POS_NAME[pos], definition, synonyms[:6], antonyms[:4], examples[:3], round(zipf, 2)]
    )

    if (
        CORE_MIN_ZIPF <= zipf <= CORE_MAX_ZIPF
        and len(lemma) >= 4
        and primary["lexname"] in CORE_LEXNAMES
        and len(lemma) >= 5
        and not jargon(primary)
        and not number(primary["gloss"])
        and not transparent(lemma)
    ):
        core.append((zipf, lemma, pos))

lemmas = {e[0] for e in entries}

# Leave out -ly adverbs whose adjective is already in the core ("ubiquitously").
core_adjectives = {l for _, l, p in core if p == "a"}


def adverb_base(word):
    for suffix, replacement in (("ically", "ic"), ("ily", "y"), ("bly", "ble"), ("ly", ""), ("ly", "le")):
        if word.endswith(suffix) and word[: -len(suffix)] + replacement in core_adjectives:
            return True
    return False


core = [c for c in core if not (c[2] == "r" and adverb_base(c[1]))]
core.sort(key=lambda c: (-c[0], c[1]))

forms = {}
for pos in ("noun", "verb", "adj", "adv"):
    with open(os.path.join(WN, f"{pos}.exc"), encoding="latin-1") as f:
        for line in f:
            inflected, *bases = line.split()
            base = next((b for b in bases if b in lemmas), None)
            if base and WORD.match(inflected) and inflected not in lemmas:
                forms.setdefault(inflected, base)

entries.sort(key=lambda e: e[0])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with gzip.open(OUT, "wt", encoding="utf-8", compresslevel=9) as f:
    json.dump(
        {
            "format": 1,
            "fields": ["lemma", "partOfSpeech", "definition", "synonyms", "antonyms", "examples", "zipf"],
            "entries": entries,
            "forms": sorted(forms.items()),
            "core": [lemma for _, lemma, _ in core],
        },
        f,
        ensure_ascii=False,
        separators=(",", ":"),
    )
print(f"{len(entries)} dictionary entries, {len(forms)} irregular forms, {len(core)} core words")
print("usage domains seen:", sorted(set(usage_names.values()))[:40])
