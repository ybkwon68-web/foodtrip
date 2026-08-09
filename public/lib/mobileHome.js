// 모바일에서는 카드 그리드(회차별 정리) 화면으로 가는 경로를 두지 않는다 — 표로 보기가
// 사실상 모바일의 홈 역할을 하므로, 좁은 화면에서는 로고를 눌러도 표로 보기로 이동한다.
(function () {
  const brand = document.querySelector('.brand');
  if (!brand) return;
  const desktopHref = brand.getAttribute('href');
  const mq = window.matchMedia('(max-width: 720px)');
  function apply(matches) {
    brand.setAttribute('href', matches ? './table.html' : desktopHref);
  }
  apply(mq.matches);
  mq.addEventListener('change', (e) => apply(e.matches));
})();
