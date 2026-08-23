# -*- coding: utf-8 -*-
"""AI 문구 (선택 기능) - 규칙기반 옆에 붙는 길. 키가 없으면 앱은 여기 안 온다.

왜 SDK 가 아니라 urllib 인가: 이 앱은 **설치 0개**(표준 라이브러리 전용)가 규칙이고
PyInstaller 로 묶인다. `anthropic` 패키지를 들이면 배포 ZIP 을 받는 사람 전부가
설치 과정을 겪는다. 그래서 `/v1/messages` 를 표준 라이브러리로 직접 부른다.
(공식 SDK 를 쓰는 편이 기본이라는 안내는 알고 있다 - 이 한 가지 이유로 예외.)

제공자 둘
  - anthropic : api.anthropic.com, 키는 **화면(브라우저 localStorage)** 에만 있고 요청마다
                같이 온다. 서버 파일에 적어 두지 않는다(ZIP 에 딸려 나가면 안 된다).
  - ollama    : 같은 PC 의 Ollama(http://127.0.0.1:11434). 키 없음. 모델 이름만.

돌려주는 꼴은 **규칙기반과 같다** - 화면은 둘을 구별하지 않는다.
  copy    → summarizer.analyze() 꼴  {titles, hooks, summaries, keywords}
  series  → summarizer.series()  꼴  {cover:{hook,title,summary}, pages:[...]}
  caption → {texts: [{style, text}]}
"""
from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request

DEFAULT_MODEL = "claude-opus-5"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODELS = [
    ("claude-opus-5", "Claude Opus 5 (기본·가장 좋음)"),
    ("claude-sonnet-5", "Claude Sonnet 5 (빠르고 쌈)"),
    ("claude-haiku-4-5", "Claude Haiku 4.5 (가장 쌈)"),
]

SYSTEM = (
    "너는 한국 대학생 대상 인스타그램 카드뉴스 계정 「뉴스 보는 대학생(뉴보대)」의 편집자다. "
    "기사 본문에 **있는 사실만** 쓴다. 본문에 없는 숫자·이름·인용을 만들지 않는다. "
    "문장은 짧고 구어체에 가깝게, 대학생이 3초 안에 읽히게. 줄표(—)·이모지·해시태그는 쓰지 않는다. "
    "반드시 요청한 JSON 꼴만 돌려준다."
)

SCHEMAS = {
    "copy": {
        "type": "object",
        "properties": {
            "titles": {"type": "array", "items": {"type": "string"}},
            "hooks": {"type": "array", "items": {"type": "string"}},
            "summaries": {"type": "array", "items": {"type": "string"}},
            "keywords": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["titles", "hooks", "summaries", "keywords"],
        "additionalProperties": False,
    },
    "series": {
        "type": "object",
        "properties": {
            "cover": {
                "type": "object",
                "properties": {
                    "hook": {"type": "string"}, "title": {"type": "string"},
                    "summary": {"type": "string"}},
                "required": ["hook", "title", "summary"],
                "additionalProperties": False,
            },
            "pages": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["point", "number", "quote", "list"]},
                        "label": {"type": "string"},
                        "head": {"type": "string"},
                        "body": {"type": "string"},
                        "num": {"type": "string"},
                        "who": {"type": "string"},
                    },
                    "required": ["kind", "label", "head", "body", "num", "who"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["cover", "pages"],
        "additionalProperties": False,
    },
    "caption": {
        "type": "object",
        "properties": {
            "texts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"style": {"type": "string"}, "text": {"type": "string"}},
                    "required": ["style", "text"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["texts"],
        "additionalProperties": False,
    },
}


def _prompt(task: str, text: str, title: str, n: int) -> str:
    head = f"[원문 제목] {title}\n\n[기사 본문]\n{text}\n\n"
    if task == "copy":
        return head + (
            "카드뉴스 앞장(1080x1350) 문구 후보를 만들어라.\n"
            "- titles: 제목 후보 5개. 각 26자 이내, 2줄로 떨어지게. 강조할 낱말 하나는 **별표**로 감싼다.\n"
            "- hooks: 맨 위 작은 한 줄 후보 5개. 6~18자. 질문형·반전형 섞어서.\n"
            "- summaries: 아래 설명문 후보 3개. 각 70~100자, 한두 문장, '-다' 체.\n"
            "- keywords: 사진 검색용 영어 낱말 3개.\n"
            "JSON: {\"titles\":[],\"hooks\":[],\"summaries\":[],\"keywords\":[]}"
        )
    if task == "series":
        return head + (
            f"이 기사를 인스타 캐러셀 「표지 1장 + 본문 {n}장」으로 나눠라.\n"
            "- cover: hook(맨 위 작은 줄, 6~18자) / title(제목, 26자 이내, 강조 낱말 하나는 **별표**) / "
            "summary(설명문 70~100자).\n"
            f"- pages: 정확히 {n}개. 각 장은 기사 속 **서로 다른** 핵심 하나를 맡고 기사 전개 순서를 따른다.\n"
            "  kind: point(일반) / number(본문에 있는 숫자 하나를 크게 박는 장, num 에 '38%' '150만 명' 같은 "
            "토막) / quote(본문 속 직접 인용을 크게 쓰는 장, head 에 따옴표 없는 인용문·who 에 발언자) / "
            "list(핵심 3가지를 '① … ② … ③ …' 줄바꿈으로 body 에 적는 장).\n"
            "  label: 'POINT 1' 처럼 차례. head: 장 제목 24자 이내(list 면 '핵심 3가지' 같은 묶음 제목). "
            "body: 설명 60~100자. 없는 값은 빈 문자열.\n"
            "- 같은 문장·같은 숫자를 두 장에 쓰지 않는다. number 장은 기사에 숫자가 있을 때만.\n"
            "JSON: {\"cover\":{\"hook\":\"\",\"title\":\"\",\"summary\":\"\"},"
            "\"pages\":[{\"kind\":\"\",\"label\":\"\",\"head\":\"\",\"body\":\"\",\"num\":\"\",\"who\":\"\"}]}"
        )
    if task == "caption":
        return head + (
            "인스타 게시물 본문(캡션) 초안 3개를 만들어라. 모두 기사에 있는 사실만.\n"
            "- style='뉴스 전달형': 250~400자. 첫 줄은 훅, 핵심 3~4문장, 마지막에 '자세한 내용은 프로필 링크' 같은 맺음.\n"
            "- style='매거진형': 300~450자. 배경→쟁점→의미 순으로 풀어쓰기, '-다' 체.\n"
            "- style='짧은 브리핑': 120~180자. 한 문단.\n"
            "해시태그·이모지는 넣지 않는다(화면에서 따로 붙인다).\n"
            "JSON: {\"texts\":[{\"style\":\"\",\"text\":\"\"}]}"
        )
    raise ValueError("모르는 작업: " + task)


def _extract_json(s: str):
    s = (s or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.S)
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.S)
        if not m:
            raise ValueError("AI 응답에 JSON 이 없습니다: " + s[:120])
        return json.loads(m.group(0))


def _post(url: str, headers: dict, body: dict, timeout: int = 120) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw).get("error", {}).get("message") or raw
        except Exception:
            msg = raw
        if e.code == 401:
            raise RuntimeError("API 키가 틀렸거나 만료됐습니다 (401).")
        if e.code == 429:
            raise RuntimeError("요청 한도에 걸렸습니다 (429). 잠시 뒤 다시.")
        raise RuntimeError(f"AI 서버 오류 {e.code}: {str(msg)[:200]}")
    except urllib.error.URLError as e:
        raise RuntimeError("AI 서버에 못 닿았습니다: " + str(e.reason))


def _anthropic(key: str, model: str, task: str, prompt: str) -> dict:
    if not key:
        raise RuntimeError("Claude API 키가 없습니다. 왼쪽 「AI 설정」에 넣으세요.")
    body = {
        "model": model or DEFAULT_MODEL,
        "max_tokens": 4000,                 # 문구 JSON 은 짧다 - 일부러 낮게
        "system": SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
        "output_config": {"format": {"type": "json_schema", "schema": SCHEMAS[task]},
                          "effort": "medium"},
    }
    j = _post(ANTHROPIC_URL, {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
    }, body)
    if j.get("stop_reason") == "refusal":
        sd = j.get("stop_details") or {}
        raise RuntimeError("AI 가 이 요청을 거절했습니다: " + str(sd.get("explanation") or sd.get("category") or ""))
    text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
    if j.get("stop_reason") == "max_tokens":
        raise RuntimeError("AI 응답이 잘렸습니다. 본문을 줄여 다시 시도하세요.")
    return _extract_json(text)


def _ollama(model: str, task: str, prompt: str, base: str = "") -> dict:
    url = (base or "").rstrip("/") + "/api/chat" if base else OLLAMA_URL
    body = {
        "model": model or "gemma3",
        "stream": False,
        "format": SCHEMAS[task],
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": prompt}],
        "options": {"temperature": 0.4},
    }
    j = _post(url, {}, body, timeout=300)
    return _extract_json(((j.get("message") or {}).get("content")) or "")


def _clean_list(xs, limit):
    out = []
    for x in xs or []:
        x = re.sub(r"\s+", " ", str(x or "")).strip()
        if x and x not in out:
            out.append(x)
    return out[:limit]


def run(task: str, text: str, title: str = "", n: int = 3, cfg: dict | None = None) -> dict:
    """화면이 준 설정(cfg={provider,key,model,base})으로 한 번 부른다."""
    cfg = cfg or {}
    text = (text or "").strip()
    if len(text) < 40:
        raise RuntimeError("본문이 너무 짧습니다(40자 이상).")
    text = text[:12000]                      # 기사 한 편이면 충분, 비용 상한
    prompt = _prompt(task, text, title or "", n)
    prov = (cfg.get("provider") or "anthropic").lower()
    if prov == "ollama":
        j = _ollama(cfg.get("model") or "", task, prompt, cfg.get("base") or "")
    else:
        j = _anthropic(cfg.get("key") or "", cfg.get("model") or DEFAULT_MODEL, task, prompt)
    # 꼴을 다듬는다 - 빠진 칸은 비우고 길이를 자른다. 화면이 바로 쓸 수 있게.
    if task == "copy":
        return {
            "titles": _clean_list(j.get("titles"), 6),
            "hooks": _clean_list(j.get("hooks"), 6),
            "summaries": _clean_list(j.get("summaries"), 4),
            "keywords": _clean_list(j.get("keywords"), 5),
            "sentences": [],
        }
    if task == "series":
        cover = j.get("cover") or {}
        pages = []
        for i, p in enumerate(j.get("pages") or [], 1):
            if not isinstance(p, dict):
                continue
            kind = str(p.get("kind") or "point")
            if kind not in ("point", "number", "quote", "list"):
                kind = "point"
            pages.append({
                "kind": kind,
                "label": str(p.get("label") or f"POINT {i}").strip(),
                "head": str(p.get("head") or "").strip(),
                "body": str(p.get("body") or "").strip(),
                "num": str(p.get("num") or "").strip(),
                "who": str(p.get("who") or "").strip(),
            })
        return {
            "cover": {"hook": str(cover.get("hook") or "").strip(),
                      "title": str(cover.get("title") or "").strip(),
                      "summary": str(cover.get("summary") or "").strip()},
            "pages": pages[:max(1, min(int(n or 3), 6))],
        }
    if task == "caption":
        texts = []
        for t in j.get("texts") or []:
            if isinstance(t, dict) and (t.get("text") or "").strip():
                texts.append({"style": str(t.get("style") or "AI"), "text": str(t.get("text")).strip()})
        return {"texts": texts[:3]}
    return j
