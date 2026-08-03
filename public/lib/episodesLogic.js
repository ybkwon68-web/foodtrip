(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.EpisodesLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function matchesSearch(ep, query) {
    if (!query) return true;
    const restaurantNames = (ep.restaurants || []).map((r) => r.name).join(' ');
    const haystack = [ep.title, ep.raw_title, ep.region, restaurantNames]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function sortEpisodes(list, mode) {
    const withEp = list.filter((e) => e.episode != null);
    const withoutEp = list.filter((e) => e.episode == null);
    withEp.sort((a, b) => (mode === 'episode' ? a.episode - b.episode : b.episode - a.episode));
    return [...withEp, ...withoutEp];
  }

  return { matchesSearch, sortEpisodes };
});
