/* bgm.js — 인스타에 올릴 때 붙일 음악을 「무드 + 검색어」로 추천한다.
 *
 * 🔴 곡 이름을 지어내지 않는다.
 *    앱에는 음원 목록도, 인스타 인기 오디오를 읽을 방법도 없다. 없는 곡을
 *    그럴듯하게 대면 그대로 올렸다가 못 찾는다. 그래서 여기서는 **무드**와
 *    **인스타 오디오 탭에 그대로 칠 검색어**까지만 준다. 곡은 사람이 고른다.
 *
 * 규칙기반이라 설치도 통신도 없다. 폰판(docs/)에서도 그대로 돈다.
 *
 * 쓰는 법
 *   const r = NB_BGM.pick({ title, body, cat });   // → 추천 하나
 *   NB_BGM.mount(hostEl, () => ({ title, body, cat }));  // → 화면에 패널
 */
(function (root) {
  'use strict';

  /* ── 무드 사전 ────────────────────────────────────────────────────────
     q = 인스타 오디오 검색창에 **그대로 칠** 말. 한국어·영어를 섞어 둔다.
     인스타 오디오는 영어 검색이 훨씬 많이 걸려서 영어를 앞에 둔다. */
  var MOODS = {
    calm: {
      n: '차분한 뉴스룸',
      d: '말이 잘 들리게 뒤에서 받쳐 주는 소리. 사실 전달이 주인공일 때.',
      q: ['news bgm', 'lofi documentary', 'calm background', '뉴스 브금', 'minimal piano'],
      avoid: '밝은 댄스, 보컬 강한 곡, 훅이 센 유행가'
    },
    heavy: {
      n: '무겁고 조심스럽게',
      d: '피해·사고·갈등처럼 가볍게 다루면 안 되는 소식.',
      q: ['emotional piano', 'sad ambient', 'serious documentary', 'somber strings', '잔잔한 피아노'],
      avoid: '유행 챌린지 곡, 신나는 비트 — 사안과 어긋나 보인다'
    },
    tense: {
      n: '긴박하게',
      d: '속보·표결·판결처럼 시간이 걸린 소식. 훑어보게 만드는 소리.',
      q: ['breaking news bgm', 'tension build up', 'cinematic tension', 'urgent beat', '긴장감 브금'],
      avoid: '느린 발라드, 잔잔한 피아노 — 속도가 안 맞는다'
    },
    bright: {
      n: '밝고 가볍게',
      d: '기록·성과·개막처럼 좋은 소식.',
      q: ['upbeat vlog', 'happy indie', 'feel good pop', 'bright acoustic', '밝은 브이로그'],
      avoid: '무거운 현악, 어두운 앰비언트'
    },
    warm: {
      n: '따뜻하게',
      d: '기부·나눔·응원처럼 마음이 움직이는 소식.',
      q: ['warm acoustic', 'heartwarming piano', 'soft guitar', 'wholesome bgm', '따뜻한 어쿠스틱'],
      avoid: '강한 비트, 전자음 위주'
    },
    explain: {
      n: '설명 · 로파이',
      d: '쟁점 정리·배경 해설처럼 읽는 시간이 필요한 카드.',
      q: ['lofi hip hop', 'chill study beat', 'explainer bgm', 'smooth lofi', '로파이 브금'],
      avoid: '가사 있는 곡 — 글자와 겹쳐서 안 읽힌다'
    },
    future: {
      n: '미래적으로',
      d: 'AI·반도체·우주처럼 기술 이야기.',
      q: ['tech background', 'futuristic ambient', 'synthwave chill', 'innovation bgm', '테크 브금'],
      avoid: '어쿠스틱 기타, 옛 감성 곡'
    }
  };

  /* ── 말뭉치 ───────────────────────────────────────────────────────────
     제목·본문에서 찾을 말. 한 번 걸릴 때마다 그 무드에 점수를 준다.
     제목에서 걸리면 3배로 친다(제목이 그 기사의 성격을 제일 잘 말해 준다). */
  var WORDS = {
    heavy: ['사망', '숨져', '숨진', '참사', '사고', '피해', '유가족', '희생',
            '논란', '비판', '갈등', '위기', '침체', '하락', '폭락', '급락',
            '파업', '소송', '고소', '고발', '처벌', '구속', '기소', '해임',
            '탄핵', '규탄', '반발', '우려', '적자', '부도', '해고', '실직',
            '붕괴', '화재', '침수', '실종', '부상', '숨졌'],
    tense: ['속보', '긴급', '단독', '전격', '표결', '판결', '선고', '개표',
            '마감', '시한', '협상', '담판', '충돌', '대치', '임박', '초읽기',
            '오늘', '내일', '결정', '발표'],
    bright: ['성장', '상승', '회복', '흑자', '최고', '최초', '신기록', '기록',
             '수상', '우승', '합격', '개막', '확대', '호조', '반등', '성공',
             '돌파', '달성', '증가', '개선'],
    warm: ['기부', '나눔', '봉사', '감동', '응원', '미담', '후원', '연대',
           '희망', '동행', '온정', '자원봉사', '위로'],
    explain: ['정리', '이유', '배경', '쟁점', '전망', '분석', '해설', '핵심',
              '왜', '무엇', '따져', '짚어', '한눈에', '총정리', '뜻', '차이'],
    future: ['AI', '인공지능', '반도체', '로봇', '우주', '위성', '바이오',
             '스타트업', '플랫폼', '데이터', '전기차', '배터리', '양자',
             '메타버스', '클라우드']
  };

  /* 갈래만 보고 주는 밑점수. 말뭉치가 하나도 안 걸려도 뭔가는 나오게 한다. */
  var BY_CAT = {
    '정치': { calm: 2, tense: 1 },
    '경제': { explain: 2, calm: 1 },
    '사회': { calm: 2, heavy: 1 },
    '세계': { calm: 2, tense: 1 },
    'IT·과학': { future: 3 },
    '종합': { calm: 2 }
  };

  function scoreOf(title, body, cat) {
    var s = {}, k;
    for (k in MOODS) s[k] = 0;

    var base = BY_CAT[cat] || BY_CAT['종합'];
    for (k in base) s[k] += base[k];

    var t = String(title || '');
    var b = String(body || '').slice(0, 1200);  // 본문은 앞부분만 본다 (뒤로 갈수록 곁가지)

    for (var mood in WORDS) {
      var list = WORDS[mood];
      for (var i = 0; i < list.length; i++) {
        var w = list[i];
        if (t.indexOf(w) >= 0) s[mood] += 3;   // 제목에서 걸리면 3배
        if (b.indexOf(w) >= 0) s[mood] += 1;
      }
    }

    /* 무거운 소식이 뚜렷하면 밝은 쪽은 눌러 둔다. 사고 기사에 신나는 곡을
       추천하는 게 이 기능에서 제일 크게 잘못될 수 있는 일이다. */
    if (s.heavy >= 3) {
      s.bright = 0;
      s.warm = Math.floor(s.warm / 2);
    }
    return s;
  }

  function pick(input) {
    input = input || {};
    var s = scoreOf(input.title, input.body, input.cat);

    var order = Object.keys(s).sort(function (a, b) {
      if (s[b] !== s[a]) return s[b] - s[a];
      return a < b ? -1 : 1;               // 점수가 같으면 이름순 — 누를 때마다 바뀌지 않게
    });

    var top = order[0], alt = order[1];
    var why = reason(input.title, input.body, top);

    return {
      key: top,
      mood: MOODS[top].n,
      desc: MOODS[top].d,
      queries: MOODS[top].q.slice(),
      avoid: MOODS[top].avoid,
      why: why,
      alt: { key: alt, mood: MOODS[alt].n, queries: MOODS[alt].q.slice() },
      scores: s
    };
  }

  /* 왜 이 무드인지 근거가 된 말을 돌려준다. 근거 없이 "이겁니다" 하면 못 믿는다. */
  function reason(title, body, mood) {
    var list = WORDS[mood] || [], hit = [];
    var t = String(title || ''), b = String(body || '').slice(0, 1200);
    for (var i = 0; i < list.length && hit.length < 4; i++) {
      if (t.indexOf(list[i]) >= 0 || b.indexOf(list[i]) >= 0) hit.push(list[i]);
    }
    return hit;
  }

  /* ── 화면 ─────────────────────────────────────────────────────────────
     host = 붙일 자리, getData = 누를 때마다 최신 제목·본문·갈래를 주는 함수 */
  function mount(host, getData) {
    if (!host) return null;

    host.innerHTML =
      '<div class="bgm-box">' +
        '<div class="bgm-head">' +
          '<b>추천 노래</b>' +
          '<span class="bgm-mood" data-bgm="mood"></span>' +
          '<button type="button" class="bgm-again" data-bgm="again">다시 보기</button>' +
        '</div>' +
        '<p class="bgm-desc" data-bgm="desc"></p>' +
        '<div class="bgm-qs" data-bgm="qs"></div>' +
        '<p class="bgm-avoid" data-bgm="avoid"></p>' +
        '<p class="bgm-tip">인스타 <b>오디오</b> 탭에 검색어를 그대로 치고, 들어 보고 고르세요. ' +
          '곡 이름은 앱이 지어내지 않습니다.</p>' +
      '</div>';

    var $ = function (n) { return host.querySelector('[data-bgm="' + n + '"]'); };

    function draw() {
      var r = pick(getData ? getData() : {});
      $('mood').textContent = r.mood;
      $('desc').textContent = r.desc +
        (r.why.length ? '  (근거: ' + r.why.join(', ') + ')' : '');

      var qs = $('qs');
      qs.innerHTML = '';
      r.queries.forEach(function (q) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'bgm-q';
        b.textContent = q;
        b.title = '누르면 복사됩니다';
        b.addEventListener('click', function () { copy(q, b); });
        qs.appendChild(b);
      });

      var a = document.createElement('button');
      a.type = 'button';
      a.className = 'bgm-q bgm-alt';
      a.textContent = '다른 결: ' + r.alt.mood;
      a.title = r.alt.queries.join(' · ') + '  (누르면 이 결의 검색어를 복사)';
      a.addEventListener('click', function () { copy(r.alt.queries.join(', '), a); });
      qs.appendChild(a);

      $('avoid').textContent = '피할 것 — ' + r.avoid;
      return r;
    }

    function copy(text, btn) {
      var done = function () {
        var old = btn.textContent;
        btn.textContent = '복사됨';
        setTimeout(function () { btn.textContent = old; }, 900);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    }

    /* http(s) 가 아닌 자리(폰판을 파일로 열었을 때)에서는 clipboard 가 막힌다 */
    function fallback(text, done) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* 조용히 넘어간다 */ }
      document.body.removeChild(ta);
    }

    $('again').addEventListener('click', draw);
    draw();
    return { redraw: draw };
  }

  var api = { pick: pick, mount: mount, MOODS: MOODS, WORDS: WORDS };

  root.NB_BGM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;  // 시험용(node)
})(typeof window !== 'undefined' ? window : globalThis);
