# -*- coding: utf-8 -*-
"""실행 진입점: 네이버 후보를 먼저 제한해 Actions 실행 시간을 안정화한다."""
import _select_news_impl as impl

_ranking_candidates = impl.ranking_candidates
_section_candidates = impl.section_candidates
_parallel_enrich = impl.parallel_enrich


def ranking_candidates(day, comment=False):
    return _ranking_candidates(day, comment=comment)[:80 if comment else 120]


def section_candidates(section):
    return _section_candidates(section)[:25]


def parallel_enrich(items, workers=20):
    return _parallel_enrich(items, workers=workers)


impl.ranking_candidates = ranking_candidates
impl.section_candidates = section_candidates
impl.parallel_enrich = parallel_enrich


if __name__ == "__main__":
    raise SystemExit(impl.main())
