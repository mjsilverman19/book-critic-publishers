# Comps

A research tool for editors and publishers. Describe a book you are considering, choose comparable titles, and see how critics received them: the balance of raves and pans, which outlets and critics covered them, what reviewers kept praising or faulting, and the quotes that show it.

It is built on [book-critic-data](https://github.com/mjsilverman19/book-critic-data), a dataset of about 62,000 books and 192,000 professional reviews, each reduced to rave, positive, mixed or pan. The data, the build and the Books, Critics, Authors and Outlets views are shared with that repository; this one replaces its reader shelf with projects.

- [Projects](#projects)
- [How comparable titles are suggested](#how-comparable-titles-are-suggested)
- [How the analysis is computed](#how-the-analysis-is-computed)
- [Research views](#research-views)
- [Data](#data)
- [Building and deploying](#building-and-deploying)
- [Repository layout](#repository-layout)

## Projects

**Projects** lists your projects with their number of comparable titles, total reviews and last edit. "new project" opens a blank one.

A project page has a title and a pitch, both edited in place, then five sections:

| Section | What it shows |
|---|---|
| Comparable titles | The titles you chose, with year, review count, a bar of their rave/positive/mixed/pan mix, adjusted score and key terms. Add titles by searching below the table, from the suggestions, or from any book page's "add to project" menu |
| Reception | The rating mix across all reviews of the comparable titles, their mean, and a chart of reviews and mean rating by publication year |
| Outlets and critics | The outlets that reviewed the most of the titles, with their ratings and their usual lean against other reviewers, and the critics who reviewed them, with each critic's ratings of the titles |
| Themes | Terms that recur in the titles' pull quotes, how many reviews use them, and what share of those reviews were positive. Selecting a term filters the quotes |
| Representative criticism | Pull quotes from the reviews, filterable by positive, mixed or negative, chosen to cover the recurring terms, prominent outlets and all the titles |

A one-paragraph brief above the sections summarizes the numbers: reviews, outlets, the positive and negative shares, the outlet that covered the most titles, and the terms most often praised or that divided critics.

Projects are stored in the browser's local storage. They stay on that browser and device and are lost if site data is cleared.

## How comparable titles are suggested

`site/build.py` writes `site/data/comps.json`, a table of distinctive terms for each of the 19,000 books with three or more rated reviews. Each book's document is its title (twice), genres, description and up to eight pull quotes. Terms are words and two-word phrases outside a stop list, with plurals folded (revolutions to revolution); a term is kept if it appears in at least 3 books and no more than 6% of them. Weights are (1 + log term count) × inverse document frequency, normalized per book, keeping the top 16. The page loads the table only when a project is opened.

Suggestions combine three signals, each scaled so its best match is 1:

- **Pitch** (weight 1). The title and pitch are tokenized the same way and scored against every book's terms. A book that matches only one term counts half.
- **Comparable titles** (weight 1). The chosen titles' terms are averaged and scored the same way.
- **Critics** (weight 0.5). Every critic who reviewed a chosen title votes for the other books they rated rave or positive, each vote divided by √(1 + the critic's review count).

The sum is then multiplied by three factors: review depth (0.75 for a book with three reviews, rising to 1 at 30), fiction or nonfiction (books on the other side of the line from the chosen titles, or from the pitch when none are chosen, count 0.6), and genre overlap with the chosen titles (0.8 to 1). The twelve best appear with the reason that contributed most: the pitch terms they matched, the chosen title they most resemble, or the critics who reviewed your titles. Dismissed suggestions stay hidden for that project.

## How the analysis is computed

- **Reception** counts every rated review of the chosen titles. Unrated reviews (most New York Times backfill rows) count toward review totals but not toward the mix or the mean.
- **Outlets** are ranked by how many of the titles they reviewed, then by number of reviews. "Vs. others" is the outlet's overall lean: its mean difference from other reviewers of the same books, across all its reviews.
- **Critics** are ranked the same way and shown with the outlet they most often wrote for in these reviews.
- **Themes** read the pull quotes of every review of the chosen titles. Each quote is tokenized as above, dropping words from the titles' own titles and author names. A term must appear in at least 2 quotes (more for large projects) and, when there are two or more titles, in quotes about at least two of them. Terms are ranked by number of quotes × inverse document frequency. "Leans" is praised when 85% or more of the rated reviews using the term were positive, mostly praised from 60%, and divided below that.
- **Representative quotes** are ranked by how many recurring terms they contain, plus a small weight for the outlet's size, minus a penalty for quotes over 400 characters, then taken in turn from each title so that one book does not fill the list.

These are word counts, not readings. A term like "regulation" may appear because reviewers wanted more of it or less; the quotes are there to check.

## Research views

Books, Critics, Authors and Outlets are sortable, filterable tables of the whole dataset, and every book, critic and outlet has its own page with all of its reviews. Hovering over a title opens a preview with its cover and synopsis. Filters and sort order live in the URL, and adding `src=bm` or `src=bf` limits every figure, including project pages, to the main review set or the backfill. The [book-critic-data README](https://github.com/mjsilverman19/book-critic-data#explorer) describes these views and their figures in full.

## Data

`data/` is a copy of book-critic-data's `data/` directory: the main review set (`books.csv`, the two reviews files and a SQLite database) and `data/backfill/` (older reviews from The Complete Review, the Guardian and the New York Times, with model-predicted ratings where the source gives none). Columns, collection methods, rating models and known issues are documented in the [book-critic-data README](https://github.com/mjsilverman19/book-critic-data#main-review-set).

`.github/workflows/sync.yml` copies `data/` from book-critic-data each day at 8:17 a.m. Eastern, two hours after that repository's own refresh, commits any changes and redeploys the site. This repository does not crawl anything itself. The crawler and backfill scripts are kept only so the data can be rebuilt if needed.

## Building and deploying

```
python3 site/build.py
python3 -m http.server -d site
```

`site/build.py` turns the CSVs into `site/data/books.json`, `site/data/index.json`, 128 shards of per-book detail under `site/data/reviews/`, and `site/data/comps.json`. It needs only the Python standard library. `.github/workflows/pages.yml` runs it and publishes `site/` to GitHub Pages on every push to `main` that touches `data/` or `site/`, and after each data sync. On deploy it appends a content hash to script and stylesheet links so browsers never pair a new page with a cached old script.

## Repository layout

| Path | Purpose |
|---|---|
| `site/projects.js`, `site/projects.css` | Projects list, project pages, suggestions and analysis, and the "add to project" menu on book pages |
| `site/index.html` | Research views, tables and routing |
| `site/preview.js`, `site/preview.css` | Hover previews of books |
| `site/build.py` | Builds the site's JSON, including the comps term table |
| `data/` | The review data, synced from book-critic-data |
| `.github/workflows/sync.yml` | Daily data sync and redeploy |
| `.github/workflows/pages.yml` | Builds and publishes the site |
| `bookmarks_scraper.py`, `update_data.py`, `backfill/` | Crawler and backfill pipeline, inherited from book-critic-data and not run here |
