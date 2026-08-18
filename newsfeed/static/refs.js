/* 참고 사이트 데이터 — 「뉴보대 및 경제 참고 웹사이트.txt」(2026-08-13)를 구조화한 것.
 *
 * 규칙: **(뉴보대) 태그가 붙은 항목만** 담는다. (뉴보대, 경제)는 포함,
 * (경제)만 붙은 것은 경제지표 카드뉴스 메이커 몫이라 여기 없다.
 * 원본 txt 를 고치면 이 파일도 같이 고칠 것 (자동 동기화 없음 — 원본이 손글이라
 * 줄마다 꼴이 달라, 실수 없이 옮기는 쪽을 택했다).
 *
 * uses 값은 네 가지로 통일: '주제 찾기' / '카드제작' / '글 작성' / '리서치·인사이트'
 * plat 은 주소에서 기계적으로 정한다(아래 NB_REF_PLAT).
 */
(function (global) {
  'use strict';

  var T = '주제 찾기', C = '카드제작', W = '글 작성', R = '리서치·인사이트';

  global.NB_REF_USES = [T, C, W, R];

  global.NB_REFS = [
    { name: '토스증권', links: [
      { url: 'https://www.instagram.com/toss.securities/', label: '인스타그램', uses: [C] },
      { url: 'https://www.youtube.com/@toss_securities/videos', label: '유튜브 영상', uses: [T] },
      { url: 'https://www.youtube.com/@Moneygraphy/videos', label: '머니그라피 영상', uses: [T] },
      { url: 'https://www.youtube.com/@Moneygraphy/posts', label: '머니그라피 커뮤니티', uses: [T] },
    ]},
    { name: '신한투자증권', links: [
      { url: 'https://www.shinhanfund.com/ko/investment/cardNews', label: '신한펀드 카드뉴스', uses: [C] },
      { url: 'https://www.instagram.com/shinhansec_official/', label: '인스타그램', uses: [C] },
      { url: 'https://www.youtube.com/@shinhansecurities', label: '유튜브', uses: [T] },
    ]},
    { name: '미래에셋', links: [
      { url: 'https://www.youtube.com/channel/UCZS9wEZ4itPbBZk_sqccXfw', label: '유튜브(스마트머니)', uses: [T] },
      { url: 'https://www.youtube.com/@SmartMoney0/posts', label: '스마트머니 커뮤니티', uses: [T] },
      { url: 'https://blog.naver.com/how2invest', label: '공식 블로그', uses: [T, C] },
    ]},
    { name: '키움증권', links: [
      { url: 'https://www.instagram.com/kiwoom.official/', label: '인스타그램', uses: [C] },
      { url: 'https://www.youtube.com/@kiwoomchk/videos', label: '유튜브 영상', uses: [T, C] },
    ]},
    { name: '어피티', links: [
      { url: 'https://uppity.co.kr/', label: '머니레터(웹)', uses: [T, C] },
      { url: 'https://www.youtube.com/@uppity_official/videos', label: '유튜브 영상', uses: [T, C] },
      { url: 'https://www.youtube.com/@uppity_official/posts', label: '커뮤니티(피드 글)', uses: [W] },
    ]},
    { name: '뉴닉', links: [
      { url: 'https://newneek.co/', label: '뉴닉(웹)', uses: [T, C] },
      { url: 'https://www.instagram.com/newneek.official/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.youtube.com/@newneek.official/videos', label: '유튜브 영상', uses: [T, C] },
      { url: 'https://www.youtube.com/@newneek.official/posts', label: '커뮤니티(피드 글)', uses: [W] },
    ]},
    { name: '순살브리핑', links: [
      { url: 'https://soonsal.com/cardnews/', label: '카드뉴스 모음', uses: [C] },
      { url: 'https://www.instagram.com/soonsal.brief/', label: '인스타그램', uses: [C] },
      { url: 'https://www.youtube.com/@soonsal/videos', label: '유튜브 영상', uses: [T, C] },
      { url: 'https://www.youtube.com/@soonsal/posts', label: '커뮤니티(피드 글)', uses: [W] },
    ]},
    { name: '투교협', links: [
      { url: 'https://www.kcie.or.kr/mobile/guide/series/0/', label: '투자가이드 전체', uses: [T] },
      { url: 'https://www.instagram.com/kcie2018/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.youtube.com/@kcie01/videos', label: '유튜브 영상', uses: [T, C] },
    ]},
    { name: '블룸버그', links: [
      { url: 'https://x.com/Bloomberg', label: 'X(트위터)', uses: [T, C] },
      { url: 'https://www.youtube.com/@markets/videos', label: '유튜브 Markets', uses: [T, C] },
      { url: 'https://www.youtube.com/@business/videos', label: '유튜브 Business', uses: [T, C] },
      { url: 'https://www.instagram.com/bloomberg/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.instagram.com/bloombergbusiness/', label: '인스타그램 Business', uses: [T, C] },
    ]},
    { name: '인베스팅닷컴', links: [
      { url: 'https://www.youtube.com/@Investingcom-kr/videos', label: '유튜브(한국)', uses: [T, C] },
      { url: 'https://www.instagram.com/investingcom/', label: '인스타그램', uses: [T, C] },
    ]},
    { name: '파이낸셜타임즈', links: [
      { url: 'https://www.instagram.com/financialtimes/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.youtube.com/@FinancialTimes/videos', label: '유튜브 영상', uses: [T, C] },
      { url: 'https://www.youtube.com/@FinancialTimes/posts', label: '커뮤니티(피드 글)', uses: [T, W] },
    ]},
    { name: '비주얼 캐피탈리스트', links: [
      { url: 'https://www.visualcapitalist.com/', label: '웹(인포그래픽)', uses: [T, C] },
      { url: 'https://www.instagram.com/visualcap/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.youtube.com/@visualcap/videos', label: '유튜브 영상', uses: [T, C] },
    ]},
    { name: '월스트리트 저널', links: [
      { url: 'https://www.wsj.com/', label: 'WSJ(웹)', uses: [T, C] },
      { url: 'https://www.instagram.com/wsj/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.instagram.com/wsjmag/?hl=ko', label: '인스타그램 매거진', uses: [T, C] },
      { url: 'https://www.facebook.com/WSJ/', label: '페이스북', uses: [T, C] },
    ]},
    { name: '로이터', links: [
      { url: 'https://www.instagram.com/thomsonreuters/', label: '인스타그램', uses: [T, C] },
      { url: 'https://x.com/ReutersGraphics', label: 'X 그래픽스', uses: [T, C] },
      { url: 'https://www.reuters.com/graphics/', label: '그래픽스(웹)', uses: [T, C] },
      { url: 'https://www.instagram.com/reutersplus/', label: '인스타그램 플러스', uses: [T, C] },
      { url: 'https://www.reuters.com/science/eclipse-craze-grips-spain-iceland-millions-get-set-event-century-2026-08-12/',
        label: '기사 예시(개기일식)', uses: [T] },
    ]},
    { name: 'CNBC', links: [
      { url: 'https://www.instagram.com/cnbc/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.instagram.com/cnbctv/', label: '인스타그램 TV', uses: [T, C] },
      { url: 'https://www.instagram.com/cnbcmakeit/', label: '인스타그램 Make It', uses: [T, C] },
      { url: 'https://www.instagram.com/cnbcibrandstudio/', label: '인스타그램 브랜드스튜디오', uses: [T, C] },
      { url: 'https://www.instagram.com/cnbcevents/', label: '인스타그램 이벤트', uses: [T, C] },
    ]},
    { name: '이코노미스트', links: [
      { url: 'https://www.economist.com/1843', label: '1843 매거진', uses: [T, C] },
      { url: 'https://www.economist.com/topics/the-world-ahead-2026', label: 'The World Ahead 2026', uses: [T, C] },
      { url: 'https://www.economist.com/podcasts', label: '팟캐스트', uses: [T, C] },
      { url: 'https://www.economist.com/insider', label: '인사이더', uses: [T, C] },
      { url: 'https://www.instagram.com/theeconomist/', label: '인스타그램', uses: [T, C] },
      { url: 'https://www.instagram.com/theeconomist/reels/', label: '인스타그램 릴스', uses: [T, C] },
      { url: 'https://www.instagram.com/1843mag/', label: '인스타그램 1843', uses: [T, C] },
    ]},
    { name: 'stocksharks', links: [
      { url: 'https://www.instagram.com/stocksharks/', label: '인스타그램', uses: [T, C] },
    ]},
  ];

  /** 주소에서 플랫폼 이름을 기계적으로 뽑는다(데이터에 중복으로 적지 않기 위해). */
  global.NB_REF_PLAT = function (url) {
    if (/instagram\.com/.test(url)) return '인스타그램';
    if (/youtube\.com/.test(url)) return '유튜브';
    if (/facebook\.com/.test(url)) return '페이스북';
    if (/(^|\/\/)x\.com/.test(url)) return 'X';
    if (/blog\.naver\.com/.test(url)) return '블로그';
    return '웹';
  };
})(window);
