# Live lookup benchmark — October 7, 2026

GPT-4.1 mini remains the default. It answered this sample in roughly two seconds,
handled the selected words in context, and supplied the requested compound-word
breakdowns. GPT-4o mini costs less but did not show a clear speed advantage.
GPT-4.1 nano was faster on average but made substantial translation and
word-formation errors, so it is marked experimental in Settings.

## Method

The application’s actual `requestLookup` function was called from Node.js 24,
using `OPENAI_API_KEY` injected by Infisical. Requests went to the Responses API
with the application’s strict JSON schema, teacher instructions, Russian target
language, 700-token initial output budget, timeout and truncation-retry logic.
The browser’s lookup cache was bypassed. Models were tested sequentially in
rotating order, so they did not compete for the same connection.

The main run tested six examples twice per model: `belt` in `Hij belt mij op`,
`straatlamp`, `boekenkast`, `hotel`, the idiom fragment `rekening mee`, and a
conditional sentence. There were 48 requests across four models. Four further
GPT-5.5 requests tested medium reasoning on the separable verb and sentence.

## Main run

| Model | Samples | Median | Mean | Maximum | Estimated cost of sample | Estimated cost per 1,000 similar lookups |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-4.1 mini | 12 | 2.04 s | 2.03 s | 2.67 s | $0.00598 | $0.50 |
| GPT-4o mini | 12 | 2.12 s | 2.40 s | 4.78 s | $0.00216 | $0.18 |
| GPT-4.1 nano | 12 | 1.60 s | 2.05 s | 5.01 s | $0.00135 | $0.11 |
| GPT-5.5, reasoning none | 12 | 2.95 s | 3.06 s | 4.06 s | $0.09016 | $7.51 |
| GPT-5.5, reasoning medium | 4 | 3.15 s | 3.11 s | 3.50 s | $0.03440 | $8.60 |

All 52 responses passed the application’s JSON parser. There were no truncation
retries or API errors. This verifies format handling for these samples, not
semantic correctness or a guarantee that future calls will succeed.

The medium row uses a smaller, different subset. On the matching four examples,
GPT-5.5’s median was **3.00 s with none** and **3.15 s with medium**. Medium used
100 reasoning tokens in total. The old ten-second delay was not reproduced, so
this run does not establish reasoning as its sole cause.

## Quality observations

- GPT-4.1 mini correctly translated `Hij belt mij op` and identified `opbellen`.
  It explained `straatlamp` as `straat` (street) + `lamp`, and `boekenkast` as
  `boek(en)` (book/books) + `kast` (cupboard).
- GPT-4.1 nano mistranslated `belt` in both main-run repetitions. One answer
  claimed the lemma was `ophalen`; another claimed `opspringen`. Both are wrong
  for the supplied sentence. It also split `boekenkast` into `boek` + `enkast`
  and sometimes omitted the compound explanation or noun article.
- GPT-4o mini usually supplied useful translations and compound breakdowns.
  Some explanations were in English despite Russian being requested. In a
  subsequent check it translated `boekenkast` as “книга в книжном шкафу” even
  though its own explanation correctly described a cupboard for books.
- GPT-5.5 consistently provided contextual meanings and compound breakdowns in
  this small sample, but cost about 15 times as much as GPT-4.1 mini for the main
  run’s token usage.
- Grammar explanations from the small models were not uniformly accurate:
  some called an idiomatic expression a separable verb. These observations are
  a manual spot check, not a formal or blinded language-quality evaluation.

## Follow-up after clarifying explanation language

The prompt now explicitly requires translation and explanation in the target
language, allowing Dutch quotations and brief English glosses rather than entire
English/Dutch explanations. The lookup cache version was advanced so previous
answers with the old instructions are refreshed.

Fifteen fresh requests tested the separable verb, both compounds, idiom and
sentence once each on GPT-4.1 mini, GPT-4o mini and GPT-4.1 nano. All passed JSON
validation, and all explanations used Russian prose with quoted Dutch terms.
GPT-4.1 mini’s median remained **2.05 s**, GPT-4o mini’s was **1.98 s**, and
GPT-4.1 nano’s was **1.12 s**. Nano still gave the invented component `enkast`
and missed the joined lemma `opbellen`; cheaper models’ quality problems were
not fixed merely by clarifying the explanation language.

The follow-up cost an estimated **$0.00408**. Both runs together made **67 API
requests**, all successfully parsed, at an estimated **$0.13813**.

## Costs and limits

Costs use actual API token usage and the standard USD rates checked on October
7, 2026: [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini),
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini),
[GPT-4.1 nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano), and
[GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5). They are estimates,
not an invoice. The 1,000-lookup figures extrapolate this particular mix and output
length. This run reported zero cached input tokens.

Latency depends on connection, load, model availability, prompt length and output
length. These small samples do not establish tail latency or production error
rates. Node measurements exclude browser rendering and IndexedDB lookup time.
The main table was measured before the explanation-language clarification; the
follow-up measured the resulting prompt.

Safe raw results are in `test-results/lookup-benchmark.json` and
`test-results/lookup-benchmark-language-check.json`. They contain the examples,
parsed answers, timing and token metadata, without the API key or request headers.
The reusable command is `infisical run --env=dev -- npm run benchmark:lookups`.
