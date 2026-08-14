// 모바일에서는 카드 그리드(회차별 정리) 화면으로 가는 경로를 두지 않는다 — 표로 보기가
// 사실상 모바일의 홈 역할을 하므로, 좁은 화면에서는 로고를 눌러도 표로 보기로 이동한다.
(function () {
  // 로고 링크만 바꿔서는 북마크·공유 링크 등으로 index.html(카드 그리드)에 직접
  // 들어오는 경로까지는 막지 못했다(실측: 모바일에서 카드 화면이 그대로 뜨고 그 화면의
  // 검색창은 목록이 화면에 아예 안 맞게 배치돼 있어 검색해도 안 되는 것처럼 보였음) —
  // 회차 상세 딥링크(#/episode/N)가 아닌 채로 index.html에 진입하면 즉시 표로 보기로 보낸다.
  const mq = window.matchMedia('(max-width: 720px)');
  if (mq.matches) {
    const isIndexPage = /(^|\/)(index\.html)?$/.test(location.pathname);
    const isEpisodeDeepLink = /^#\/episode\//.test(location.hash || '');
    if (isIndexPage && !isEpisodeDeepLink) {
      location.replace('./table.html');
      return;
    }
  }

  const brand = document.querySelector('.brand');
  if (!brand) return;
  const desktopHref = brand.getAttribute('href');
  function apply(matches) {
    brand.setAttribute('href', matches ? './table.html' : desktopHref);
  }
  apply(mq.matches);
  mq.addEventListener('change', (e) => apply(e.matches));
})();
