# Vocabulary learning hints — October 8, 2026

The feature combines an optional saved A1–C2 learner level with a single lookup
request. GPT-4.1 mini assesses a word's general-language frequency, register and
approximate useful CEFR level independently of the learner. The application then
compares that assessment with the saved level. Hints require common frequency,
general register, a known estimated level at or below the learner's level, and a
nonempty tip. Other classifications are hidden even if the model supplies a tip.

Clicked words and highlighted single words are eligible. Multi-word selections,
sentences, and lookups without a saved level keep their existing response schema
and receive no hint. Hints use the existing lookup call rather than a second call.

## Live checks

The application's actual `requestLookup` ran against GPT-4.1 mini through the
Responses API, with Russian answers and a test key injected by Infisical. The
final prompt was spot-checked on nine curated examples. All responses parsed,
and all nine hint decisions matched the manual expectations below.

| Selected word / context | Learner level | Hint |
| --- | --- | --- |
| afspraak / appointment with a doctor | B2 | Shown |
| werkt / working in a shop | A1 | Shown |
| desondanks / going outside despite rain | A1 | Hidden: estimated B1 |
| mitsgaders / formal, old-fashioned wording | B2 | Hidden: uncommon, literary |
| eigenvector / linear algebra | B2 | Hidden: uncommon, specialist |
| schier / literary wording | B2 | Hidden: uncommon, literary |
| afspraak / one-word text selection | B2 | Shown |
| eigenvector / linear algebra | C2 | Hidden: specialist despite advanced learner level |
| schier / literary wording | C2 | Hidden: literary despite advanced learner level |

These are manual learning-priority expectations, not certified word-level CEFR
labels or a comprehensive language evaluation. Early prompts recommended rare
words too readily and anchored level estimates to the learner's level. Structured
classification with application filtering fixed the rare-word examples; assessing
the word without revealing the learner's level fixed the beginner example in the
final check. Small samples cannot establish a production error rate. Frequency,
register and difficulty remain model estimates and can still be wrong.

The final classifications and hint decisions are summarized above. No API keys
or request headers are included in this report. Final sample latency ranged
from 1.65 to 3.23 seconds.

## Application checks

Unit coverage checks settings migration, invalid saved levels, structured advice
validation, each exclusion criterion, and separate cache keys. Browser checks on
laptop and phone cover visible hints, rare and specialist words, level switching,
cached results, a highlighted single word, persistence after reload, and turning
hints off. Existing EPUB, selection, cancellation and stable-layout checks pass.
